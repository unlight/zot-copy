import { writerOpts } from 'changelog-sentence-case';

/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
  branches: ['master'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        writerOpts,
      },
    ],
    '@semantic-release/changelog',
    [
      '@semantic-release/exec',
      {
        // Runs before the release commit, so the tag carries the new version.
        prepareCmd: 'node sync-version.ts ${nextRelease.version}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'extension.json', 'package.json', 'copy.ts'],
      },
    ],
    [
      '@semantic-release/github',
      {
        // Fresh repositories have no labels; the default 422s.
        labels: false,
      },
    ],
  ],
};
