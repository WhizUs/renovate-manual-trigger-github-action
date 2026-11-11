import * as core from '@actions/core';
import { Octokit } from "@octokit/action";

const octokit = new Octokit({
  auth: core.getInput('token')
})

try {
  const renovate_repository = core.getInput('renovate-repository');

  const [owner, repo] = renovate_repository.split("/");
  const headers = {
    'X-GitHub-Api-Version': '2022-11-28'
  }

  let dependencyDashboardIssueNumber
  for await (const { data } of octokit.paginate.iterator('GET /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    state: 'open',
    per_page: 100,
    headers
  })) {
    const issue = data.find(issue => issue.title === 'Dependency Dashboard' && !issue.pull_request)
    if (issue) {
      dependencyDashboardIssueNumber = issue.number
      break
    }
  }

  if (dependencyDashboardIssueNumber === undefined) {
    throw new Error(`Open Dependency Dashboard issue not found in ${owner}/${repo}.`)
  }

  // Get the Dependency Dashboard issue
  const { data: dependencyDashboardIssue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo,
    issue_number: dependencyDashboardIssueNumber,
    headers
  })

  if (dependencyDashboardIssue.state !== 'open' || dependencyDashboardIssue.title !== 'Dependency Dashboard') {
    throw new Error(`Issue #${dependencyDashboardIssueNumber} is no longer an open Dependency Dashboard in ${owner}/${repo}.`)
  }
  if (typeof dependencyDashboardIssue.body !== 'string') {
    throw new Error(`Dependency Dashboard issue #${dependencyDashboardIssueNumber} in ${owner}/${repo} has no body.`)
  }

  // Replace the checkBoxLine string in the issue body
  const checkBoxLine = "[ ] <!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository"
  const checkBoxLineReplacement = checkBoxLine.replace('[ ]', '[x]')
  if (dependencyDashboardIssue.body.includes(checkBoxLineReplacement)) {
    console.log('INFO: The checkbox is already checked. Exiting.')
    process.exit(0)
  }
  if (!dependencyDashboardIssue.body.includes(checkBoxLine)) {
    throw new Error(`Renovate manual trigger checkbox not found in ${owner}/${repo}#${dependencyDashboardIssueNumber}.`)
  }
  const newBody = dependencyDashboardIssue.body.replace(checkBoxLine, checkBoxLineReplacement)

  const byteSize = str => new Blob([str]).size;
  if (byteSize(dependencyDashboardIssue.body) !== byteSize(newBody)) {
    console.log('ERROR: The new body is not the same size as the old body. Exiting the script as a safety measure.')
    process.exit(1)
  }

  // Update the issue body
  await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo,
    issue_number: dependencyDashboardIssueNumber,
    body: newBody,
    headers
  })
} catch (error) {
  core.setFailed(error.message);
}