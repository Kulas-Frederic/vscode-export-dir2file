# Change Log

All notable changes to the "export-dir2file" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.4] - Juk 8, 2024

- Catch errors when strip comments is not supported

## [0.2.3] - Jul 7, 2024

- The tree structure and QuickPick are no longer affected by include rules.
- Rules are refreshed without reloading VSCode by using the ConfigManager instead of a static Config object.
- The sorting of the TreeStructure now matches VSCode explorer sorting rules.

## [0.2.1] & [0.2.2] - Jul 7, 2024

- Readme updates

## [0.2.0] - Jul 6, 2024

- Added command `directory2file.selectFilesToExport` to select files to export from the tree with saving the last selection

## [0.1.3] - Jul 5, 2024

- minor fixes

## [0.1.2] - Jul 5, 2024

- `description` property in `exportconfig.json` is now could be string or object with `main` and `activeTabs` keys descriptions for export files and active tabs commands
- fix of description not exported on some commands

## [0.1.0] - Jul 2, 2024

- bug fixes

## [0.0.7] - Jul 2, 2024

- Configuration for custom descriptions for export files and active tabs commands
- fixed issue with duplicate tree structure
- tree structure now includes on active tabs export
- minor fixes

## [0.0.6] - Jul 1, 2024

- Rewrite to classes and improve performance

## [0.0.4] - Jun 27, 2024

- Initial release
