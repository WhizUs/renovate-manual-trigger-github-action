const core = require('@actions/core');
const github = require('@actions/github');

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

  // Get all issues
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    headers
  })

  // Find the Dependency Dashboard issue
  var dependencyDashboardIssueNumber = null
  for (const issue of data) {
    var i = data.find(issue => issue.title === 'Dependency Dashboard')
    if (i) {
      dependencyDashboardIssueNumber = i.number
      break
    }
  }

  // Get the Dependency Dashboard issue
  const { data: dependencyDashboardIssue } = await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo,
    issue_number: dependencyDashboardIssueNumber,
    headers
  })

  // Replace the checkBoxLine string in the issue body
  const checkBoxLine = "[ ] <!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository"
  const checkBoxLineReplacement = checkBoxLine.replace('[ ]', '[x]')
  if (dependencyDashboardIssue.body.includes(checkBoxLineReplacement)) {
    console.log('INFO: The checkbox is already checked. Exiting.')
    process.exit(0)
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