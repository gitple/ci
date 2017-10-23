'use strict';
var githubhook = require('githubhook');
var _ = require('lodash');
var os = require('os');
var process = require('process');
var async = require('async');

var github = githubhook({
  port: process.env.CI_PORT,
  secret: process.env.CI_SECRET,
  path: '/',
});
const spawn = require('child_process').spawn;

var CFG = require('./config.json');

var slack;
var slackChannel;
var repoPath;
if (_.get(CFG, 'notification.selection') === 'slack' && CFG.notification.selection.webhookurl) {
  slack = require('slack-notify')(CFG.notification.selection.webhookurl);
  slackChannel = CFG.notification.selection.channel || 'ci';
}

repoPath= CFG.repoPath || process.cwd();
_.each(CFG.jobs, (j) => {
  if (!_.isArray(j.targets)) { j.targets = [j.targets]; }
  if (!_.isArray(j.commands)) { j.commands = [j.commands]; }
});

var failLast = true;

//console.log('CFG', JSON.stringify(CFG));
function runCmd(cmd, changed, cb) {
  //FIXME: use spawn async
  
  process.chdir(repoPath);
  const rtn = spawn('/bin/bash', ['-c', cmd]);

  let stdout = '';
  let stderr = '';
  rtn.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  rtn.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  rtn.on('exit', (exitCode) => {
    console.log('runCmd: ' + cmd);
    console.log('STDOUT', stdout);
    if (exitCode !== 0) {
      console.log('Error status=' + exitCode);
      console.log('STDERR', stderr);
      if (slack) {
        slack.send({
          channel: '#' + slackChannel,
          text: [
          'STDOUT:', '```', stdout, '```', 
          'STDERR:', '```', stderr, '```', 
          'CHANGED:', '```', JSON.stringify(changed, null, 2), '```' ].join('\n'),
          username: 'ci-' + os.hostname()
        });
      }
      return cb(Error('Exit code=' + exitCode));
    } else {
      return cb();
    }
  });
}

github.listen();

//function process(event, data) {
github.on('push:five:refs/heads/develop', function (data) {
  var changed = [];
  _.each(data.commits, function(commit) {
   changed = _.union(changed, commit.added, commit.removed, commit.modified);
 });
 changed = _.sortBy(changed);

 console.log('changed files=', changed);

 async.eachSeries(CFG.jobs, (j, jDone) => {
   let met = _.some(j.targets, (t) => {
     if (t === '*') { return true; }
     return _.some(changed, (v) => _.startsWith(v, t));
   });
   if (!met) { return jDone(); }
   async.eachSeries(j.commands, (cmd, cmdDone) => {
     runCmd(cmd, changed, cmdDone);
   }, function(err) {
     return jDone(err);
   });
 }, function(err){
   if (err) {
     failLast = true;
     console.log('job done with error:', err.toString());
   } else {
     if (failLast === true) {
       if (slack) {
         slack.send({
           channel: '#' + slackChannel,
           text: ['OK - from the last failure', 
             'CHNAGED:', '```', JSON.stringify(changed, null, 2), '```'].join('\n'),
           username: 'ci-' + os.hostname()
         });
       }
     }
     failLast = false;
     console.log('job done!');
   }
 });
});
