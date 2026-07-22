# Fixtures

**These are hand-authored, not copied from `microsoft/winget-pkgs`.** They are structurally
faithful to real manifests but the SHA-256 values are fabricated — do not treat them as a
source of truth about any real package.

Real-world coverage comes from the corpus job instead: linting a pinned `winget-pkgs`
snapshot, where every manifest is known-good because Microsoft accepted it, so any
diagnostic we emit is by definition a false positive in one of our rules.

Layout mirrors winget's own: `<letter>/<Publisher>/<Package>/<Version>/`.
