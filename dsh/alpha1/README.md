# Pinned Harness integration

The current author runtime uses official DeepSeek Harness 0.1.3-alpha.1, tag dsh-v0.1.3-alpha.1, commit d347e703908d0406b7a7ef80e3a0e594d86b2215, and pnpm 11.7.0. Setup-Harness.ps1 installs the original frozen graph, restores only the reviewed local UI patch and current voice client, verifies that every upstream resolved package remains unchanged, builds the host/client/frontend and registers both profiles.

The current author profile is author-web on 8796. The sdk profile supports the retained 8793 preview. Both use isolated project-relative data/workspace directories. Upgrades remain a separate compatibility decision.

Run node dsh/alpha1/run-proof.mjs for a keyless SDK handshake after setup. Ordinary installation and tests send no provider requests. The --live option exists only for a separately approved real model task and requires private configuration; it was not used for this release.

Private provider configuration, session logs, generated files and live receipts are excluded. Current verification results and limitations are recorded in ../../ACCEPTANCE.md. Historical UI acceptance metadata is anonymized and does not claim production real-time lip sync.
