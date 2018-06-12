#!/usr/bin/env babel-node

import { spawn } from 'child_process'
import fs from 'fs-extra'
import path from 'path'
import { ArgumentParser } from 'argparse'
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
parser.addArgument([ '-S', '--since' ], {
  help: 'Get from commits which more recent than a specific date',
  isOptional: true,
})
parser.addArgument([ '-O', '--output' ], {
  help: 'Set output script path',
})

const args = parser.parseArgs()

if (!args.project || !args.output) {
  parser.exit(1, 'No enough arguments\n\n' + parser.formatUsage())
}

function spawnAsync(command, args, opts) {
  console.log('$ ' + command + ' ' + args.join(' '))
  const print = 'print' in opts ? opts.print : true
  delete opts.print
  return new Promise((resolve, reject) => {
    const cmd = spawn(command, args, opts)
    let stdout = ''
    let stderr = ''
    cmd.stdout.on('data', (data) => {
      if (print) process.stdout.write(data)
      stdout += data.toString()
    })
    cmd.stderr.on('data', (data) => {
      if (print) process.stdout.write(data)
      stderr += data.toString()
    })
    cmd.on('close', (code) => {
      const ret = {
        code,
        stdout,
        stderr,
      }
      if (code === 0) {
        resolve(ret)
      } else {
        reject(ret)
      }
    })
  })
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
    await spawnAsync('git', [ 'pull', 'origin', 'master' ], { cwd: repoPath })
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

  let ret = await spawnAsync('git', [ 'log', '--oneline', '--since=' + (lastInfo.last_time + 1), '-P', '--grep=\'#[0-9]+\'' ], { cwd: repoPath, print: false })

  const lines = ret.stdout.split('\n')
  const prRegex = /#(\d+)/

  const scripts = []
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(prRegex)
    if (m) {
      const pullNum = m[1]
      console.log('scanning pull request #' + pullNum + '\'s comments')
      const comments = await github.getIssueComments(project, pullNum)
      for (const comment of comments) {
        comment.body = comment.body.replace(/\r/g, '')
        const startIndex = comment.body.indexOf('```sh\n')
        if (startIndex >= 0) {
          const endIndex = comment.body.indexOf('\n```', startIndex + 5)
          if (endIndex >= 0) {
            // keep end newline
            const script = comment.body.substr(startIndex + 6, endIndex - (startIndex + 6))
            console.log(script)
            scripts.push({ pull: pullNum, script, author: comment.user.login })
          }
        }
      }
    }
  }

  if (scripts.length > 0) {
    let allScript = '#!/bin/sh\n\n'
    const baseScript = githubConfig.base_scripts && project in githubConfig.base_scripts
      ? githubConfig.base_scripts[project] : ''
    if (baseScript) {
      allScript += '# base script\n'
        + baseScript + '\n\n'
    }
    for (let i = 0; i < scripts.length; i++) {
      allScript += '# from pull request #' + scripts[i].pull + ' ' + scripts[i].author + '\n'
        + scripts[i].script + '\n\n'
    }
    await fs.writeFile(args.output, allScript)
  } else {
    console.log('No extra script need to run.')
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
