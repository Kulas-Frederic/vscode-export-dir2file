import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import ignore from 'ignore'
import { minimatch } from 'minimatch'
import stripComments from 'strip-comments'

export function activate(context: vscode.ExtensionContext) {
  let exportCommand = vscode.commands.registerCommand(
    'directory2file.exportToFile',
    exportToMarkdown
  )
  let createIgnoreCommand = vscode.commands.registerCommand(
    'directory2file.createIgnore',
    createExpIgnore
  )
  let createIncludeCommand = vscode.commands.registerCommand(
    'directory2file.createInclude',
    createExpInclude
  )
  let exportTabsCommand = vscode.commands.registerCommand(
    'directory2file.exportActiveTabs',
    exportActiveTabs
  )
  let openSettingsCommand = vscode.commands.registerCommand(
    'directory2file.openSettings',
    openExtensionSettings
  )

  console.log(
    'Global ignore rules:',
    vscode.workspace.getConfiguration('directory2file').get('globalIgnoreRules')
  )
  // console.log(
  //   'Global include rules:',
  //   vscode.workspace
  //     .getConfiguration('directory2file')
  //     .get('globalIncludeRules')
  // )

  context.subscriptions.push(
    exportCommand,
    createIgnoreCommand,
    createIncludeCommand,
    exportTabsCommand,
    openSettingsCommand
  )
}

export async function exportToMarkdown(context: vscode.ExtensionContext) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Exporting directory to file',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
        if (!workspaceFolder) {
          throw new Error('No workspace folder open')
        }

        const rootPath = workspaceFolder.uri.fsPath
        const config = await getConfig(rootPath)
        const outputPath = await ensureOutputPath(
          rootPath,
          config.output || 'export.md'
        )
        let output: string[] = []

        const ignoreRules = await getIgnoreRules(rootPath, config.ignoreFile)
        const includeRules = await getIncludeRules(rootPath, config.includeList)

        if (config.description) {
          const descriptionPath = path.join(rootPath, config.description)
          if (fs.existsSync(descriptionPath)) {
            const descriptionContent = fs.readFileSync(descriptionPath, 'utf8')
            output.push(descriptionContent + '\n\n')
          } else {
            output.push(config.description + '\n\n')
          }
        }

        const includeStructure =
          config.includeProjectStructure ??
          (await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: 'Include project structure at the top of the file?',
          })) === 'Yes'

        if (includeStructure) {
          output.push('# Project Structure\n\n```\n')
          output.push(
            await generateProjectStructure(rootPath, ignoreRules, includeRules)
          )
          output.push('```\n\n')
        }

        output.push('# File Contents\n\n')

        progress.report({ increment: 50, message: 'Processing directory...' })

        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage('Export operation was cancelled')
          return
        }

        await processDirectory(
          rootPath,
          rootPath,
          ignoreRules,
          includeRules,
          output,
          config.removeComments === true,
          new Set(),
          progress,
          token
        )

        if (token.isCancellationRequested) {
          vscode.window.showInformationMessage('Export operation was cancelled')
          return
        }

        progress.report({ increment: 50, message: 'Writing output file...' })
        fs.writeFileSync(outputPath, output.join(''))
        vscode.window.showInformationMessage(`Files exported to ${outputPath}`)
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Error exporting files: ${error.message}`
        )
      }
    }
  )
}

async function processDirectory(
  dirPath: string,
  rootPath: string,
  ignoreRules: ReturnType<typeof ignore>,
  includeRules: string[],
  output: string[],
  removeComments: boolean,
  processedPaths: Set<string>,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<void> {
  if (processedPaths.has(dirPath)) {
    console.warn(`Skipping already processed directory: ${dirPath}`)
    return
  }
  processedPaths.add(dirPath)

  try {
    const files = await vscode.workspace.fs.readDirectory(
      vscode.Uri.file(dirPath)
    )
    for (const [file, fileType] of files) {
      if (token.isCancellationRequested) {
        return
      }

      const filePath = path.join(dirPath, file)
      const relativePath = path.relative(rootPath, filePath)

      if (
        !ignoreRules.ignores(relativePath) ||
        shouldIncludeFile(relativePath, includeRules)
      ) {
        if (fileType === vscode.FileType.Directory) {
          await processDirectory(
            filePath,
            rootPath,
            ignoreRules,
            includeRules,
            output,
            removeComments,
            processedPaths,
            progress,
            token
          )
        } else if (
          fileType === vscode.FileType.File &&
          shouldIncludeFile(relativePath, includeRules)
        ) {
          const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(filePath)
          )
          let fileContent = new TextDecoder().decode(content)
          const fileExtension = path.extname(file).slice(1)

          if (removeComments) {
            try {
              fileContent = stripComments(fileContent, {
                language: fileExtension,
                preserveNewlines: true,
              })
            } catch (error) {
              console.warn(
                `Unable to strip comments from ${file}. Using original content.`
              )
            }
          }

          output.push(
            `## ${relativePath}\n\n\`\`\`${fileExtension}\n${fileContent.trimRight()}\n\`\`\`\n\n`
          )
          progress.report({
            increment: 1,
            message: `Processed ${relativePath}`,
          })
        }
      }
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Error processing directory ${dirPath}: ${error.message}`
    )
  }
}

async function getConfig(rootPath: string): Promise<{
  ignoreFile: string
  includeList: string
  includeProjectStructure?: boolean
  output: string
  description?: string
  removeComments?: boolean
  allowIgnoredOnTabsExport?: boolean
}> {
  try {
    const configPath = path.join(rootPath, 'exportconfig.json')
    let config = {
      ignoreFile: '.export-ignore',
      includeList: '.export-include',
      output: 'export.md',
      removeComments: false,
      allowIgnoredOnTabsExport: false,
    }
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8')
      config = { ...config, ...JSON.parse(configContent) }
    }
    return config
  } catch (error: any) {
    throw new Error(`Error reading config: ${error.message}`)
  }
}

async function getIgnoreRules(rootPath: string, ignoreFile: string) {
  try {
    const globalIgnoreRules = vscode.workspace
      .getConfiguration('directory2file')
      .get('globalIgnoreRules', []) as string[]

    let ignoreRules = ignore().add(globalIgnoreRules)

    const ignorePath = path.join(rootPath, ignoreFile)
    if (fs.existsSync(ignorePath)) {
      const ignoreContent = fs.readFileSync(ignorePath, 'utf8')
      ignoreRules = ignoreRules.add(
        ignoreContent.split('\n').filter((line) => line.trim() !== '')
      )
    }

    // Add default ignore rules
    ignoreRules = ignoreRules.add([
      '.git',
      'node_modules',
      '.vscode',
      'dist',
      'out',
      '*.vsix',
    ])

    return ignoreRules
  } catch (error: any) {
    throw new Error(`Error getting ignore rules: ${error.message}`)
  }
}

function shouldIncludeFile(
  relativePath: string,
  includeRules: string[]
): boolean {
  if (includeRules.length === 0) {
    return true // If no include rules specified, include everything
  }

  return includeRules.some((rule) => {
    if (rule.endsWith('/**')) {
      // Handle directory wildcard
      const dirPath = rule.slice(0, -3)
      return relativePath.startsWith(dirPath)
    }
    return minimatch(relativePath, rule, { matchBase: true, dot: true })
  })
}

async function getIncludeRules(
  rootPath: string,
  includeList: string
): Promise<string[]> {
  try {
    const globalIncludeRules: string[] = vscode.workspace
      .getConfiguration('directory2file')
      .get('globalIncludeRules', [])
    const includePath = path.join(rootPath, includeList)
    let includeRules: string[] = [...globalIncludeRules]

    if (fs.existsSync(includePath)) {
      const includeContent = fs.readFileSync(includePath, 'utf8')
      const newRules: string[] = includeContent
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((pattern) => pattern.trim())
      includeRules = includeRules.concat(newRules)
    }
    return includeRules
  } catch (error: any) {
    throw new Error(`Error getting include rules: ${error.message}`)
  }
}

async function generateProjectStructure(
  rootPath: string,
  ignoreRules: ReturnType<typeof ignore>,
  includeRules: string[]
): Promise<string> {
  let result = ''

  async function addToStructure(
    currentPath: string,
    indent: string = ''
  ): Promise<void> {
    try {
      const files = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(currentPath)
      )
      files.sort((a, b) => {
        const aIsDir = a[1] === vscode.FileType.Directory
        const bIsDir = b[1] === vscode.FileType.Directory
        if (aIsDir && !bIsDir) {
          return -1
        }
        if (!aIsDir && bIsDir) {
          return 1
        }
        return a[0].localeCompare(b[0])
      })

      for (const [file, fileType] of files) {
        const filePath = path.join(currentPath, file)
        const relativePath = path.relative(rootPath, filePath)

        if (
          !ignoreRules.ignores(relativePath) ||
          shouldIncludeFile(relativePath, includeRules)
        ) {
          if (fileType === vscode.FileType.Directory) {
            result += `${indent}${file}/\n`
            await addToStructure(filePath, indent + '  ')
          } else {
            result += `${indent}${file}\n`
          }
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Error generating project structure: ${error.message}`
      )
    }
  }

  await addToStructure(rootPath)
  return result
}

async function createExpIgnore() {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      throw new Error('No workspace folder open')
    }

    const rootPath = workspaceFolder.uri.fsPath
    const config = await getConfig(rootPath)
    const expIgnorePath = path.join(rootPath, config.ignoreFile)

    if (fs.existsSync(expIgnorePath)) {
      const choice = await vscode.window.showQuickPick(
        ['Overwrite', 'Append', 'Cancel'],
        {
          placeHolder: `${config.ignoreFile} already exists. What would you like to do?`,
        }
      )

      if (choice === 'Cancel' || !choice) {
        return
      }

      if (choice === 'Append') {
        const content = await vscode.window.showInputBox({
          prompt: 'Enter patterns to ignore (separate via comma)',
        })
        if (content) {
          let ignoreList = content.split(',')
          ignoreList = ignoreList.map((item) => item.trim())
          for (const item of ignoreList) {
            fs.appendFileSync(expIgnorePath, `${item}\n`)
          }
          vscode.window.showInformationMessage(`${config.ignoreFile} updated`)
        }
        return
      }
    }

    const gitignorePath = path.join(rootPath, '.gitignore')
    let initialContent = ''
    if (fs.existsSync(gitignorePath)) {
      initialContent = fs
        .readFileSync(gitignorePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .join(', ')
    }

    const content = await vscode.window.showInputBox({
      prompt: 'Enter patterns to ignore (separate via comma)',
      value: initialContent,
    })

    if (content) {
      let ignoreList = content.split(',')
      ignoreList = ignoreList.map((item) => item.trim())
      fs.writeFileSync(expIgnorePath, ignoreList.join('\n') + '\n')
      vscode.window.showInformationMessage(`${config.ignoreFile} created`)
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Error creating ignoreFile: ${error.message}`
    )
  }
}

async function createExpInclude() {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      throw new Error('No workspace folder open')
    }

    const rootPath = workspaceFolder.uri.fsPath
    const config = await getConfig(rootPath)
    const expIncludePath = path.join(rootPath, config.includeList)

    if (fs.existsSync(expIncludePath)) {
      const choice = await vscode.window.showQuickPick(
        ['Overwrite', 'Append', 'Cancel'],
        {
          placeHolder: `${config.includeList} already exists. What would you like to do?`,
        }
      )

      if (choice === 'Cancel' || !choice) {
        return
      }

      if (choice === 'Append') {
        const content = await vscode.window.showInputBox({
          prompt: 'Enter patterns to include (separate via comma)',
        })
        if (content) {
          let includeList = content.split(',')
          includeList = includeList.map((item) => item.trim())
          for (const item of includeList) {
            fs.appendFileSync(expIncludePath, `${item}\n`)
          }
          vscode.window.showInformationMessage(`${config.includeList} updated`)
        }
        return
      }
    }

    const content = await vscode.window.showInputBox({
      prompt: 'Enter patterns to include (separate via comma)',
    })

    if (content) {
      let includeList = content.split(',')
      includeList = includeList.map((item) => item.trim())
      fs.writeFileSync(expIncludePath, includeList.join('\n') + '\n')
      vscode.window.showInformationMessage(`${config.includeList} created`)
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Error creating includeList: ${error.message}`
    )
  }
}

async function exportActiveTabs() {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      throw new Error('No workspace folder open')
    }

    const rootPath = workspaceFolder.uri.fsPath
    const config = await getConfig(rootPath)
    const outputPath = await ensureOutputPath(
      rootPath,
      config.output || 'active-tabs-export.md'
    )

    let output: string[] = []

    const activeTabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputText)
      .map((tab) => (tab.input as vscode.TabInputText).uri.fsPath)

    const ignoreRules = await getIgnoreRules(rootPath, config.ignoreFile)
    const includeRules = await getIncludeRules(rootPath, config.includeList)

    const includeStructure =
      config.includeProjectStructure ??
      (await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Include project structure at the top of the file?',
      })) === 'Yes'

    if (includeStructure) {
      output.push('# Project Structure\n\n```\n')
      output.push(
        await generateProjectStructure(rootPath, ignoreRules, includeRules)
      )
      output.push('```\n\n')
    }

    output.push('# Active Tabs Content\n\n')

    for (const filePath of activeTabs) {
      const relativePath = path.relative(rootPath, filePath)
      const isIgnored = ignoreRules.ignores(relativePath)
      const shouldInclude = shouldIncludeFile(relativePath, includeRules)

      if ((isIgnored && !config.allowIgnoredOnTabsExport) || !shouldInclude) {
        const includeIgnored = await vscode.window.showQuickPick(
          ['Yes', 'No'],
          {
            placeHolder: `${relativePath} is ignored or not included. Include it anyway?`,
          }
        )
        if (includeIgnored !== 'Yes') {
          continue
        }
      }

      let content = fs.readFileSync(filePath, 'utf8')
      if (config.removeComments) {
        content = stripComments(content)
      }
      const fileExtension = path.extname(filePath).slice(1)
      output.push(
        `## ${relativePath}\n\n\`\`\`${fileExtension}\n${content.trimRight()}\n\`\`\`\n\n`
      )
    }

    fs.writeFileSync(outputPath, output.join(''))
    vscode.window.showInformationMessage(
      `Active tabs exported to ${outputPath}`
    )
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Error exporting active tabs: ${error.message}`
    )
  }
}

async function ensureOutputPath(
  rootPath: string,
  outputPath: string
): Promise<string> {
  try {
    const fullPath = path.join(rootPath, outputPath)
    const outputDir = path.dirname(fullPath)

    if (!fs.existsSync(outputDir)) {
      const createDir = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: `Output directory ${outputDir} does not exist. Create it?`,
      })

      if (createDir === 'Yes') {
        fs.mkdirSync(outputDir, { recursive: true })
      } else {
        throw new Error('Output directory does not exist and was not created.')
      }
    }

    return fullPath
  } catch (error: any) {
    throw new Error(`Error ensuring output path: ${error.message}`)
  }
}

async function openExtensionSettings() {
  await vscode.commands.executeCommand(
    'workbench.action.openSettings',
    'Export Directory to File'
  )
}

export function deactivate() {}
