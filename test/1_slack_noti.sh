#!/bin/bash
cd ../

CI_PORT=51234
CI_WEB_PORT=8443
SLACK_PORT=51235

RUNNIG_PID=`lsof -i :$CI_PORT | grep LISTEN | awk '{print $2}'`
[ -n "$RUNNIG_PID" ] && kill -9 "$RUNNIG_PID"
CI_PORT=$CI_PORT CI_WEB_PORT=$CI_WEB_PORT CI_SECRET=nosecret \
  CI_CONFIG=./test/fixtures/config2.js \
./ci.sh > ./ci.log 2>&1 &

#slack port listen
nc -l -p $SLACK_PORT > /dev/null 2>&1 &

sleep 1

curl --insecure \
-H "Content-Type: application/json" \
-H "User-Agent: GitHub-Hookshot/e20df6f" \
-H "X-GitHub-Delivery: 567518ce-cd23-11e7-84f0-23b0fce68248" \
-H "X-GitHub-Event: push" \
-H "X-Hub-Signature: sha1=6c0a55d79d697b908b3c8c351cd3107deda36b2c" \
-d "@./test/fixtures/payload.json" -X POST https://localhost:51234/ > /dev/null  2>&1

# take time for nc to terminate after getting slack message
sleep 3

# finalize
RUNNIG_PID=`lsof -i :$CI_PORT | grep LISTEN | awk '{print $2}'`
[ -n "$RUNNIG_PID" ] && kill -9 "$RUNNIG_PID" > /dev/null 2>&1

RUNNIG_PID=`lsof -i :$SLACK_PORT | grep LISTEN | awk '{print $2}'`
if [ -n "$RUNNIG_PID" ]; then
  kill -9 "$RUNNIG_PID" > /dev/null 2>&1
  echo "$0: SLACK failure"
else
  echo "$0: OK"
fi
