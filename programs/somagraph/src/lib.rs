use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, Token2022, TransferChecked, BurnChecked};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("SoMaGrPh111111111111111111111111111111111111");

/// Somagraph Core Program
///
/// On-chain attestation layer for the Somagraph longevity protocol.
/// Handles four core instructions:
///   1. initialize_protocol  — one-time setup of treasury and config PDAs
///   2. record_analysis      — immutable attestation of a biomarker analysis
///   3. burn_payment         — burn 1,000 $SOMA for analysis access
///   4. usdc_buyback_burn    — cron-triggered USDC → SOMAGRAPH → burn cycle
///
/// SECURITY: No raw biomarker data touches this program. Only SHA-256 hashes
/// of normalized marker JSON are stored as attestations.
#[program]
pub mod somagraph_core {
    use super::*;

    /// Initialize the protocol configuration and treasury accounts.
    /// Can only be called once by the deployer authority.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        config: ProtocolConfig,
    ) -> Result<()> {
        let state = &mut ctx.accounts.protocol_state;

        require!(!state.initialized, SomagraphError::AlreadyInitialized);

        state.authority = ctx.accounts.authority.key();
        state.treasury = ctx.accounts.treasury.key();
        state.somagraph_mint = config.somagraph_mint;
        state.usdc_mint = config.usdc_mint;
        state.burn_amount_per_analysis = config.burn_amount_per_analysis;
        state.usdc_fee_lamports = config.usdc_fee_lamports;
        state.buyback_ratio_bps = config.buyback_ratio_bps; // basis points, e.g. 5000 = 50%
        state.total_analyses = 0;
        state.total_burned = 0;
        state.analysis_nonce = 0;
        state.initialized = true;

        emit!(ProtocolInitialized {
            authority: state.authority,
            treasury: state.treasury,
            somagraph_mint: state.somagraph_mint,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Record an immutable analysis attestation on-chain.
    ///
    /// Stores only the SHA-256 hash of the normalized biomarker panel,
    /// the computed PhenoAge, and the longevity score. No PII.
    pub fn record_analysis(
        ctx: Context<RecordAnalysis>,
        panel_hash: [u8; 32],  // sha256(canonical_markers_json)
        phenoage: f64,
        longevity_score: u8,   // 0-100
    ) -> Result<()> {
        require!(longevity_score <= 100, SomagraphError::InvalidScore);

        let state = &mut ctx.accounts.protocol_state;
        let attestation = &mut ctx.accounts.attestation;

        attestation.wallet = ctx.accounts.user.key();
        attestation.panel_hash = panel_hash;
        attestation.phenoage = phenoage;
        attestation.longevity_score = longevity_score;
        attestation.nonce = state.analysis_nonce;
        attestation.timestamp = Clock::get()?.unix_timestamp;
        attestation.bump = ctx.bumps.attestation;

        state.total_analyses = state
            .total_analyses
            .checked_add(1)
            .ok_or(SomagraphError::Overflow)?;
        state.analysis_nonce = state
            .analysis_nonce
            .checked_add(1)
            .ok_or(SomagraphError::Overflow)?;

        emit!(AnalysisRecorded {
            wallet: attestation.wallet,
            panel_hash,
            phenoage,
            longevity_score,
            nonce: attestation.nonce,
            timestamp: attestation.timestamp,
        });

        Ok(())
    }

    /// Burn 1,000 $SOMA from the user's token account.
    ///
    /// Called when the user pays for analysis with $SOMA tokens.
    /// The entire amount is permanently destroyed (deflationary).
    pub fn burn_payment(ctx: Context<BurnPayment>) -> Result<()> {
        let state = &mut ctx.accounts.protocol_state;
        let burn_amount = state.burn_amount_per_analysis;

        // Execute SPL Token-2022 burn
        let cpi_accounts = BurnChecked {
            mint: ctx.accounts.somagraph_mint.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token_2022::burn_checked(cpi_ctx, burn_amount, 6)?; // 6 decimals

        state.total_burned = state
            .total_burned
            .checked_add(burn_amount)
            .ok_or(SomagraphError::Overflow)?;

        emit!(TokensBurned {
            wallet: ctx.accounts.user.key(),
            amount: burn_amount,
            total_burned: state.total_burned,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Execute USDC buyback-and-burn cycle.
    ///
    /// Triggered by a cron job every 24 hours. Swaps accumulated USDC
    /// from the treasury into $SOMA via Jupiter, then burns the
    /// acquired tokens.
    ///
    /// SECURITY: Only the protocol authority (multisig) can invoke this.
    pub fn usdc_buyback_burn(
        ctx: Context<UsdcBuybackBurn>,
        swap_amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.protocol_state.authority,
            SomagraphError::Unauthorized
        );

        // NOTE: In production, this instruction will include a CPI call
        // to Jupiter's swap program. The skeleton below documents the
        // intended flow. Actual Jupiter CPI integration requires their
        // latest SDK and route computation off-chain.
        //
        // Pseudoflow:
        //   1. Transfer `swap_amount` USDC from treasury → Jupiter
        //   2. Jupiter swaps USDC → SOMAGRAPH at best route
        //   3. Burn acquired SOMAGRAPH tokens
        //   4. Emit BuybackExecuted event

        emit!(BuybackExecuted {
            authority: ctx.accounts.authority.key(),
            usdc_amount: swap_amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────
// ACCOUNT STRUCTURES
// ─────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProtocolConfig {
    pub somagraph_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub burn_amount_per_analysis: u64,  // e.g. 1_000_000_000 (1000 tokens × 10^6)
    pub usdc_fee_lamports: u64,         // e.g. 5_000_000 ($5 USDC × 10^6)
    pub buyback_ratio_bps: u16,         // basis points for buyback portion
}

#[account]
#[derive(Default)]
pub struct ProtocolState {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub somagraph_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub burn_amount_per_analysis: u64,
    pub usdc_fee_lamports: u64,
    pub buyback_ratio_bps: u16,
    pub total_analyses: u64,
    pub total_burned: u64,
    pub analysis_nonce: u64,
    pub initialized: bool,
}

#[account]
pub struct AnalysisAttestation {
    pub wallet: Pubkey,
    pub panel_hash: [u8; 32],
    pub phenoage: f64,
    pub longevity_score: u8,
    pub nonce: u64,
    pub timestamp: i64,
    pub bump: u8,
}

// ─────────────────────────────────────────────────────────────────────
// INSTRUCTION CONTEXTS
// ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + std::mem::size_of::<ProtocolState>(),
        seeds = [b"protocol_state"],
        bump,
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: Treasury account validated by authority
    pub treasury: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordAnalysis<'info> {
    #[account(
        mut,
        seeds = [b"protocol_state"],
        bump,
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = user,
        space = 8 + std::mem::size_of::<AnalysisAttestation>(),
        seeds = [b"attestation", user.key().as_ref(), &protocol_state.analysis_nonce.to_le_bytes()],
        bump,
    )]
    pub attestation: Account<'info, AnalysisAttestation>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BurnPayment<'info> {
    #[account(
        mut,
        seeds = [b"protocol_state"],
        bump,
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    /// CHECK: Validated against protocol_state.somagraph_mint
    #[account(
        mut,
        constraint = somagraph_mint.key() == protocol_state.somagraph_mint
    )]
    pub somagraph_mint: AccountInfo<'info>,

    /// The user's $SOMA token account
    #[account(mut)]
    pub user_token_account: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct UsdcBuybackBurn<'info> {
    #[account(
        mut,
        seeds = [b"protocol_state"],
        bump,
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub somagraph_mint: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AnalysisRecorded {
    pub wallet: Pubkey,
    pub panel_hash: [u8; 32],
    pub phenoage: f64,
    pub longevity_score: u8,
    pub nonce: u64,
    pub timestamp: i64,
}

#[event]
pub struct TokensBurned {
    pub wallet: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
    pub timestamp: i64,
}

#[event]
pub struct BuybackExecuted {
    pub authority: Pubkey,
    pub usdc_amount: u64,
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────

#[error_code]
pub enum SomagraphError {
    #[msg("Protocol already initialized")]
    AlreadyInitialized,

    #[msg("Longevity score must be 0-100")]
    InvalidScore,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Unauthorized: signer is not the protocol authority")]
    Unauthorized,

    #[msg("Insufficient token balance for burn")]
    InsufficientBalance,
}
