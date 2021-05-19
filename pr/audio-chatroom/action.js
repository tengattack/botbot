import fs from 'fs'
import { spawnAsync } from '../../lib/common'
import { parseTemplate } from './template'
import { initClient, getRepoName, getRepoPath, beforeCreatePR, beforeUpdatePR } from '../utils'

const getPRCommits = async (project, id, total) => {
  const { github, user } = await initClient()
  console.log('查询提交中……')
  const result = []
  let page = 1
  while (total > 0) {
    const r = await github.listPullRequest(project, id, page++)
    total -= 100
    result.push(...r)
  }
  return result
    .filter(
      (v) =>
        v.author &&
        v.author.login &&
        v.author.login !== user.login &&
        v.commit.message.startsWith('frontend')
    )
    .map((v) => ({ login: v.author.login, msg: v.commit.message }))
}

const afterPRUpdated = async (project, data, newVersion) => {
  const { github, user } = await initClient()
  const repoPath = getRepoPath(getRepoName(project))
  const commits = await getPRCommits(project, data.number, data.commits)
  const groupedCommits = {}
  commits.forEach((v) => {
    const { login, msg } = v
    if (!groupedCommits[login]) {
      groupedCommits[login] = []
    }
    groupedCommits[login].push(msg)
  })
  const commitUsers = Object.keys(groupedCommits)
  const oldReviewers = (data.requested_reviewers || []).map((v) => v.login).filter((v) => v)
  const diffReviewers = oldReviewers
    .reduce(
      (x, y) => {
        const index = x.indexOf(y)
        if (index > -1) {
          x.splice(index, 1)
        }
        return x
      },
      [...commitUsers]
    )
    .filter((v) => v !== user.login)
  if (diffReviewers.length) {
    console.log('同步 reviewer 中……')
    try {
      await github.requestReviewers(project, data.number, {
        reviewers: diffReviewers,
      })
      console.log('reviewer 同步成功')
    } catch (e) {
      console.log(e)
      console.log('reviewer 同步失败')
    }
  }
  console.log('更新 PR 信息中……')
  const baseBodyDataMap = {}
  Object.keys(groupedCommits).forEach((name) => {
    groupedCommits[name].forEach((title, i) => {
      const baseBodyData = {
        name,
        title,
        showName: i === 0,
        uatChecked: false,
        prodChecked: false,
      }
      if (!baseBodyDataMap[name]) {
        baseBodyDataMap[name] = []
      }
      baseBodyDataMap[name].push(baseBodyData)
    })
  })
  let versionChanged = false
  if (newVersion) {
    if (/^(\d+\.)*\d$/.test(newVersion)) {
      const pkgPath = `${repoPath}/package.json`
      const pkg = JSON.parse(fs.readFileSync(pkgPath).toString())
      const oldVersion = pkg.version
      if (oldVersion !== newVersion) {
        pkg.version = newVersion
        fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, undefined, 2)}\n`)
        await spawnAsync('git', ['add', '.'], { cwd: repoPath })
        await spawnAsync('git', ['commit', '-m', `version: ${oldVersion} => ${newVersion}`], {
          cwd: repoPath,
        })
        await spawnAsync('git', ['push'], { cwd: repoPath })
        versionChanged = true
      }
    } else {
      console.log(`version 格式有误，需满足 /^(\d+\.)*\d$/（${newVersion}）`)
      console.log('version 更新失败')
    }
  }
  const titleMatch = /^(.*)(\s\().*(\))$/.exec(data.title)
  const titleSuffix = newVersion && versionChanged ? ` (v${newVersion})` : ''
  const newTitle =
    titleMatch && titleMatch[1] && versionChanged
      ? `${titleMatch[1]}${titleSuffix}`
      : `${data.title}${titleSuffix}`
  await github.updatePullRequest(project, data.number, {
    body: await parseTemplate(baseBodyDataMap, data.body),
    title: newTitle,
  })
  console.log(`PR#${data.number} 同步成功`)
  console.log(data.html_url)
}

export const createPR = async (args) => {
  const { github, user } = await initClient()
  const { project, version } = args
  const branchName = await beforeCreatePR(project)
  console.log('创建 PR 中……')
  const pull = await github.createPullRequest(project, {
    title: 'frontend: 将 master 最新提交合并至 stable 分支',
    head: `${user.login}:${branchName}`,
    base: 'stable',
  })
  console.log(`PR#${pull.number} 创建成功`)
  await afterPRUpdated(project, pull, version)
}

export const updatePR = async (args) => {
  const { github } = await initClient()
  const { project, version, id } = args
  await beforeUpdatePR(project, id)
  console.log('查询 PR 中……')
  const pull = await github.getPullRequest(project, id)
  await afterPRUpdated(project, pull, version)
}
