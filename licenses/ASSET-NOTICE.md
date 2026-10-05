# Source and asset notice

Newly authored project code and documentation are provided under the root MIT
license. This grant does not replace third-party licenses or grant rights to
excluded media and model assets.

## Public repository

- The default SVG placeholder is newly authored for this project and covered by
  the root MIT license. It uses no external portrait or reference media.
- Project adapters, deterministic permission contracts and independent Jev/voice
  integration code are included. Installed dependencies retain their own terms.
- Source references and bounded synthetic-test evidence may be included. Personal
  conversations, private provider configuration, credentials, runtime logs,
  workspaces, backups and model binaries are excluded.

## Upstream runtime and dependencies

DeepSeek Harness is a separately downloaded MIT upstream. The active integration
baseline is version `0.1.3-alpha.1`, tag `dsh-v0.1.3-alpha.1`, commit
`d347e703908d0406b7a7ef80e3a0e594d86b2215`, matching
`dsh/alpha1/version-lock.json`. The setup script downloads this source into the
ignored `vendor/` directory; it is not redistributed as part of this repository.
Cordis, TypeSafe SDK and other installed packages keep their original licenses
and notices. Runtime compatibility and prior verification do not imply ownership
of upstream code.

Voice behavior was reviewed against `beiyege-01/dsh-voice-ai-girlfriend` v0.3.0,
commit `480bbabada7335735cad591eaa55f32fe54a4214`. The local voice package is an
independent implementation; author source, demo media, voice samples and model
weights are not copied into this repository. The reviewed upstream declares
Apache-2.0 at the root, MIT for its client plugin, and separate media restrictions.
See `packages/voice-plugin/README.md` for the implementation scope.

## Excluded local media

The original fictional adult portrait is user-approved for local use; no public
distribution license is inferred. `public/assets/portrait.png` is excluded.
The optional `public/assets/idle.mp4` was generated locally with Ditto dependencies
whose stock pretrained face models have noncommercial/research restrictions.
Neither the clip nor those model weights are distributed. Asset-manifest entries
marked `publish: false` describe excluded local research assets and do not grant
publication rights.

No reference video/audio, cloned voice samples, noncommercial model outputs or
model weights are included. Installing a model or using a local asset remains
subject to its own license. The project MIT license does not remove those terms.
