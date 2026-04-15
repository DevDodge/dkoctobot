#!/usr/bin/env node
// PM2 startup script for Flowise/Octobot server
process.chdir(__dirname + '/packages/server/bin')
const oclif = require('@oclif/core')
oclif.run(['start']).then(require('@oclif/core/flush')).catch(require('@oclif/core/handle'))
