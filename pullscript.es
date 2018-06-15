#!/usr/bin/env babel-node

import fs from 'fs-extra'
import path from 'path'
import { ArgumentParser } from 'argparse'
import { spawnAsync } from './lib/common'
import GithubClient from './lib/github'
import config from './config'
import { start } from 'repl';

const GITHUB_GIT = 'git@github.com:'

const parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'Generate deploy script from pull request comments.',
})
parser.addArgument([ '-P', '--project' ], {
  help: 'Specify project, eg. tengattack/botbot',
})
parser.addArgument([ '-s', '--since' ], {
  help: 'Get from commits which more recent than a specific date',
  isOptional: true,
})
parser.addArgument([ '--output' ], {
  help: 'Set output script path',
})
parser.addArgument([ '--output-sql' ], {
  help: 'Set output sql path',
})

const args = parser.parseArgs()

if (!args.project || !args.output || !args.output_sql) {
  parser.exit(1, 'No enough arguments\n\n' + parser.formatUsage())
}

function getScripts(pull, comment, type, authors) {
  if (!authors.includes(comment.user.login)) {
    // unauthorized authors
    return []
  }
  const body = comment.body.replace(/\r/g, '')
  const scripts = []
  let startIndex = 0
  while (startIndex >= 0) {
    startIndex = body.indexOf('```' + type + '\n', startIndex)
    if (startIndex >= 0) {
      let endIndex = body.indexOf('\n```', startIndex + 5)
      if (endIndex >= 0) {
        // keep end newline
        const script = body.substr(startIndex + 6, endIndex - (startIndex + 6))
        console.log(script)
        const m = script.match(/^# schedule: (\S*)/)
        let schedule = 'after-pull' // default schedule
        if (m) {
          schedule = m[1]
        }
        scripts.push({ schedule, pull, script, author: comment.user.login })
        endIndex += 4
      }
      startIndex = endIndex
    }
  }
  return scripts
}

async function main(args) {
  const githubConfig = config['github']
  const github = new GithubClient({ access_token: githubConfig.access_token })
  const project = args.project
  const repoPath = path.join(githubConfig['repo_path'], project)

  if (!(await fs.exists(repoPath))) {
    const cwd = path.dirname(repoPath)
    try {
      await fs.mkdirp(cwd)
    } catch (e) {}
    await spawnAsync('git', [ 'clone', GITHUB_GIT + project + '.git' ], { cwd })
  } else {
    const s = await fs.stat(repoPath)
    if (!s.isDirectory()) {
      throw new Error('Repository is not a directory')
    }
    await spawnAsync('git', [ 'pull' ], { cwd: repoPath })
  }

  const lockFile = path.join(repoPath, '.pullscript.lock')
  let lastInfo = {}
  if (args.since) {
    lastInfo.last_time = parseInt(args.since)
  } else {
    try {
      let data = await fs.readFile(lockFile)
      data = JSON.parse(data)
      if (!data.last_time) {
        throw new Error('Unexcepted lock content')
      }
      lastInfo.last_time = parseInt(data.last_time)
    } catch (e) {
      parser.exit(2, 'Couldn\'t found last time info in .pullscript.lock file')
      return
    }
  }

  let ret = await spawnAsync('git', [ '--no-pager', 'log', '--oneline', '--since=' + (lastInfo.last_time + 1), '--grep=\'#[0-9]\\+\'' ],
    { cwd: repoPath, shell: true, print: false })

  const lines = ret.stdout.split('\n')
  const prRegex = /#(\d+)/

  const scripts = []
  const sqls = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(prRegex)
    if (m) {
      const pullNum = m[1]
      console.log('scanning pull request #' + pullNum + '\'s comments')
      const comments = await github.getIssueComments(project, pullNum)
      for (const comment of comments) {
        let s = getScripts(pullNum, comment, 'sh', githubConfig.authors)
        if (s && s.length > 0) {
          scripts.push(...s)
        }
        s = getScripts(pullNum, comment, 'sql', githubConfig.authors)
        if (s && s.length > 0) {
          sqls.push(...s)
        }
      }
    }
  }

  const scheduleList = [ 'before-pull', 'pull', 'after-pull', 'before-sql', 'after-sql' ]
  let allScript = '#!/bin/sh\n\n'
  const baseScript = githubConfig.base_scripts && project in githubConfig.base_scripts
    ? githubConfig.base_scripts[project] : ''

  allScript += 'if [ "$2" == "" ]; then\n'
  if (typeof baseScript === 'string') {
    allScript += '# base script\n' + baseScript + '\n\n'
  }
  if (typeof baseScript === 'object' && 'cwd' in baseScript) {
    allScript += '# base script (cwd)\ncd ' + baseScript['cwd'] + '\n\n'
  }
  for (const schedule of scheduleList) {
    if (schedule === 'after-sql') {
      allScript += 'fi\n\nif [ "$2" == "after-sql" ]; then\n'
      if (typeof baseScript === 'object' && 'cwd' in baseScript) {
        allScript += '# base script (cwd)\ncd ' + baseScript['cwd'] + '\n\n'
      }
    }
    if (typeof baseScript === 'object') {
      if (schedule in baseScript) {
        allScript += '# base script (' + schedule + ')\n' + baseScript[schedule] + '\n\n'
      }
    }
    scripts.filter((s) => s.schedule === schedule).forEach((s) => {
      allScript += '# from pull request #' + s.pull + ' ' + s.author + ' (' + schedule + ')\n'
        + s.script + '\n\n'
    })
  }
  allScript += 'fi\n'

  await fs.writeFile(args.output, allScript)

  let allSQL = ''
  if (typeof baseScript === 'object' && 'sql' in baseScript) {
    allSQL += '-- base script\n' + baseScript['sql'] + '\n\n'
  }
  sqls.filter((s) => s.schedule !== 'none').forEach((s) => {
    allSQL += '-- from pull request #' + s.pull + ' ' + s.author + '\n'
      + s.script + '\n\n'
  })
  if (allSQL) {
    await fs.writeFile(args.output_sql, allSQL)
  }

  ret = await spawnAsync('git', [ 'log', '-1', '--pretty=format:%ct %H' ], { cwd: repoPath, print: false })

  const s = ret.stdout.split(' ')
  lastInfo.last_time = parseInt(s[0])
  lastInfo.last_sha = s[1]

  fs.writeFile(lockFile, JSON.stringify(lastInfo))
}

main(args).catch((e) => {
  parser.exit(1, e.message ? e.message + '\n' : undefined)
})
