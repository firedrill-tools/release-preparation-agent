# Original fictional Git populations

`index.json` is `release-populations`1.0.0:12cases/four profiles,525590bytes SHA256`0e567a8230cf4795b6d7ef35acea50b18733bd59b4d54ec7d20cc2ba35876edc`. `npm run check:data` reproduces exact bytes. The original small `npm run seed` fixture is preserved separately.

Cases cover ordinary complete drafts, scoped and footer breaking changes, a busy48-unreleased-commit/51-total-commit graph with two merges/three branches/three historical tags, reverted features under the explicit policy, wrong version, omitted commit, dirty review note, stale current draft, genuine unchanged draft, an actual interrupted two-file draft and maximum-safe-component overflow. Full graph/messages/source, Unicode, a bounded long body and hostile repository instructions are present. Source instructions grant no tool permission.

Pinned images contain original regular source files and complete Git object/index/ref bytes. The explicit trusted author constructs real Git encodings with fixed timestamps/identities and portable stored-DEFLATE object bodies. Actual owned Git reads/fsck/ancestor/full-log/rev-list/status/index/ref checks validate each image; they are not fake command transcripts. The original index has zeroed stat cache so Git reads actual content without depending on author machine inode/mtime. No model can call this author or Git mutations.

Each case has six internally linked authored historical inspection/local-draft records over actual historical commits/tags. These are fictional historical source records; earlier model calls, human authentication and publication are unknown. They are not inserted into current runtime authority. New initialization makes two genuine synthetic-human inspections (six for busy; zero for overflow) through the same managed backend. Unchanged/stale/partial cases explicitly author a current fresh-instance local draft or real between-file interruption. That history is separately identified as synthetic-human work. Native operations must obtain their own genuine current read and exact caller intent.

## Private CLI

```sh
npm run cases -- list
npm run cases -- init --repo /tmp/meridian-release-case --case busy-merge-release
npm run cases -- inspect --repo /tmp/meridian-release-case
npm run cases -- reset --repo /tmp/meridian-release-case --destination /tmp/meridian-release-fresh
```

These commands are model-free and do not read provider keys. Init requires an absent destination, writes original files privately, creates fresh UUID/root authority, records actual initialization reads/effects and publishes private seed/reference files. File creation and authority publication are separate disk effects; an interrupted initialization preserves its partial private root and returns no successful case result. The normal source rejects missing, stripped, changed or foreign referenced authority. Private inspection returns original/current source and controller evidence and stays outside model context.

Reset validates the original pinned definition and private seed, then reconstructs that case in another absent directory with a new UUID/root/file identity. It preserves the old checkout, refs, persistent mutex, controller/effects and receipts. Valid current changes remain distinguishable from the original seed. The known overflow seed stays invalid with `version_exhausted` and can reset only while its full original seed is recognized; unknown corrupt source is refused. Prepared history stays unresolved rather than being silently repaired. Dataset reset does not reset provider accounts or release publication.

`tests/cases-native.test.js` runs ten actual pinned SDK/native/Git controls with explicitly authored provider responses. Partial prepared and overflow cases are explicit zero-request preflights. Private assessment/source/seed records never become model tool data; the model sees business scope and the task through the ordinary three-tool application. No model semantic success or paid-provider evidence is implied.
