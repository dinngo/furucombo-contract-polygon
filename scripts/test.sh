#!/bin/bash

# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
    # kill hardhat instances run by this script
    if [[ ${need_to_clean} != 1 ]]; then
        exit 0
    fi

    for hardhat_pid in ${hardhat_pids}
    do
        # kill the hardhat instance that we started (if we started one and if it's still running).
        if [ -n "$hardhat_pid" ] && ps -p ${hardhat_pid} > /dev/null; then
            kill -9 ${hardhat_pid}
            echo "killed hardhat" ${hardhat_pid}
        fi
    done

}

hardhat_port=8545
tests="$@"

hardhat_running() {
    nc -z localhost "$hardhat_port"
}

start_hardhat() {
    echo "RPC_NODE:" $RPC_NODE

    npx hardhat node --fork $RPC_NODE --no-deploy >/dev/null &

    need_to_clean=1

    echo "no deployment script will be executed"
}

wait_hardhat_ready() {
    while ! hardhat_running
    do
        sleep 1
    done

    hardhat_pids=`ps aux | grep hardhat | awk '{ print $2 }'`
    echo "hardhat pids:" ${hardhat_pids}
}

echo "running tests:"
echo "$tests"

if hardhat_running; then
    echo "Using existing hardhat network instance"
else
    echo "Starting new hardhat network instance"
    start_hardhat
fi

wait_hardhat_ready

npx hardhat --version

# Execute rest test files with suffix `.test.js`
npx hardhat --network localhost test $tests
