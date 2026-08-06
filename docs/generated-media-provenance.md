# Generated Media Provenance

## Last Rotation Opening

- Status: Human reviewed and accepted on 2026-08-06.
- Review: cryptic, mysterious, intriguing; archive voice appropriate.
- Provider: HeyGen Video Agent.
- Account plan at generation: Creator subscription.
- Session: `57a755ef07b040b0a7e990c00ec34280`.
- Video: `106a2a23d2bb409d995b522a6858b9f9`.
- Source session: <https://app.heygen.com/video-agent/57a755ef07b040b0a7e990c00ec34280>
- Duration: 65.216 seconds.
- Delivery: H.264 1920x1080 at 25 fps; AAC stereo at 48 kHz.

Reviewed application assets:

| Path | Bytes | SHA-256 |
|---|---:|---|
| `public/media/presentation/last-rotation-intro.mp4` | 27,377,163 | `7b9fe72aa56878a0b70a63a1c646e32ce45ee2e7f0f27476515cccf4897cf15a` |
| `public/media/presentation/last-rotation-poster.jpg` | 232,568 | `b2d79e3841aba18e9498ffe570aa2f3b4f14a6ca26994143744a6c0dc21e2646` |
| `public/media/presentation/last-rotation-intro.srt` | 1,908 | `7f6ae511309ecd71f10b65bca921de77dcbcfed2790bb8b491478df8ee887d17` |
| `public/media/presentation/last-rotation-intro.vtt` | 1,637 | `a8eb57f1e69c68ea8526d3cd13d48cd07172d4c9ff8b0f417b10871ced5a55a5` |

The application uses the original video plus separate WebVTT captions so the
player can toggle captions. The provider's burned-caption delivery remains an
external review artifact and is not shipped.

Usage-rights basis:

- HeyGen Terms of Service, section 3, effective March 6, 2025 and last updated
  July 23, 2026: <https://www.heygen.com/terms>.
- For Creator, Pro, and Business plans, the terms state that as between HeyGen
  and the user, the user owns rights in User Input and User Output; HeyGen does
  not restrict use of User Output for the user's own purposes, including
  commercial purposes, and assigns any rights it acquires in User Output.
- The terms require the user to hold necessary input rights, warn that output
  may not be unique or free from third-party claims, and require AI-origin
  disclosure where applicable law requires it. This repository records the AI
  generation source explicitly and does not represent the cinematic as wholly
  human-generated.
- The Video Agent resources report `source_type: generated`; no third-party user
  footage, identity, voice clone, or uploaded copyrighted asset was supplied.
  Human review remains the basis for canon and suitability, not a warranty of
  non-infringement.

The narration ends at 64.53 seconds on "This record now enters the Last
Rotation." The remaining visual title card has no subtitle or spoken title.

## Phase 5 Voice And Tactical Graphics

- Status: Complete delivery was human reviewed and enabled on 2026-08-06.
- Voice provider: Deepgram Aura-2 through the installed `dg` CLI. Meridian
  Compact uses `aura-2-orion-en`; Axiom Choir uses `aura-2-luna-en`. All 68
  final tactical lines were reviewed, and timing outliers were rewritten and
  regenerated before delivery.
- Image provider: Azure OpenAI GPT-image-2 through deployment `gpt-image-2-2`.
  The title, 12 class-specific cards, and four narrative portraits were reviewed
  individually. The title was center-cropped to 1280x720; cards and portraits
  were converted to bounded WebP delivery files.
- Candidate location: ignored `tools/media-candidates/`; candidates and rejected
  revisions are not application assets.
- Delivery locations: `public/media/voices/` and `public/media/presentation/`.
- The complete delivery contains 68 tactical voice files, 12 unit cards, four
  narrative portraits, and one title poster. Per-file byte counts, SHA-256 hashes,
  exact provider models/deployment, and all available Azure request IDs are in
  `docs/phase-5-media-receipt.json`.

Usage-rights basis: generation used the project's authenticated Deepgram and
Azure OpenAI accounts with original project-authored scripts and prompts; no
third-party identity, uploaded artwork, voice clone, or copyrighted source asset
was supplied. Delivery is governed by the applicable Deepgram terms
(<https://deepgram.com/terms>) and Microsoft Product Terms / Azure service terms
(<https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/all>).
Generated output may not be unique and remains subject to third-party claims and
applicable AI-disclosure rules. Human review establishes project suitability,
not a warranty of non-infringement.
