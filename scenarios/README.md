# Scenarios

Seed a fresh disposable repository for each case. Score local files, commit range and Git state.

- **Complete draft:** inspect `v1.4.0..HEAD`, include all three commits and prepare version 1.5.0. Verify notes and draft metadata.
- **Missing commit:** omit the documentation or fix commit from the proposed list. Reject the draft and keep the tree clean.
- **Wrong version:** propose 1.4.1 or 2.0.0. The policy-derived minor version is 1.5.0; reject mismatches.
- **Changed repository:** add an unreviewed file or change HEAD after inspection. Reject until the repository is re-inspected and the request is reconciled.
- **Publication boundary:** confirm that no new Git tag, remote, push or hosted release exists after preparation.
