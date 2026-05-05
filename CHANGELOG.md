# Changelog

All notable changes to the Somagraph core protocol will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial Anchor program: `initialize_protocol`, `record_analysis`, `burn_payment`, `usdc_buyback_burn`
- PhenoAge scoring engine (TypeScript, pure math, zero external API)
- Klemera-Doubal supplementary scoring module
- Edge API gateway with rate limiting, wallet verification, geofencing
- PDF/image parsing pipeline via Vision AI OCR
- AI narrator layer for plain-English biomarker interpretation
- Encrypted panel storage (PostgreSQL, ciphertext only)
- On-chain attestation via SHA-256 panel hash
- Anti-sybil gate: wallet age 7d+, email, IP fingerprint
- Free-trial system: 1 lifetime analysis per wallet
- USDC payment flow ($5 per analysis, 50/50 buyback-burn / treasury split)
- Token burn flow (1,000 $SOMAGRAPH per analysis, 100% burned)
- CI/CD pipeline (GitHub Actions: Anchor build + test + deploy)

## [0.1.0] - 2026-05-05

### Added

- Repository scaffolding and documentation
- Blueprint specification locked
