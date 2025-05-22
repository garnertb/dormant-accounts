---
mode: 'agent'
tools: ['githubRepo', 'codebase']
description: 'Generate a new README for a GitHub Action'
---

Create or update the README in ${fileDirname}, using a similar format to the one in #githubRepo actions/checkout. Use the local actions.yml to determine inputs and outputs. In the usuage example, provide a summary for each input, that includes the default value. Be sure reference markdown instructions from [../instructions/md.instructions.md](../instructions/md.instructions.md).
