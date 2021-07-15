# Exit script as soon as a command fails.
# Exit script as soon as a command fails.
set -o errexit

# Executes cleanup function at script exit.
trap cleanup EXIT

cleanup() {
    # kill the ganache instance that we started (if we started one and if it's still running).
    if [ -n "$ganache_pid" ] && ps -p $ganache_pid > /dev/null; then
        kill -9 $ganache_pid
    fi
}

ganache_port=8545

ganache_running() {
    nc -z localhost "$ganache_port"
}

start_ganache() {
    TEST_MNEMONIC_PHRASE="dice shove sheriff police boss indoor hospital vivid tenant method game matter"
    MATIC_PROVIDER='0x986a2fCa9eDa0e06fBf7839B89BfC006eE2a23Dd'
    WMATIC_PROVIDER='0xc803698a4BE31F0B9035B6eBA17623698f3E2F82'
    WETH_PROVIDER='0xF59E93290383ED15F73Ee923EbbF29f79e37B6d8'
    DAI_PROVIDER="0xBA12222222228d8Ba445958a75a0704d566BF2C8"
    WBTC_PROVIDER="0x6AF54856Ae6033c5313B331ebD9C8ef17d48714b"
    BAT_PROVIDER="0x262000E1cCC8aB7456D7FDDEEc3F6C280F157008"
    USDT_PROVIDER="0x51E3D44172868Acc60D68ca99591Ce4230bc75E0"
    COMP_PROVIDER="0xeF18CA5fbb98C30F06ce45cEd7d8a87825fA9fDf"
    USDC_PROVIDER="0x986a2fCa9eDa0e06fBf7839B89BfC006eE2a23Dd"
    CRV_PROVIDER="0x3E0a5FdE01ab05186F7808B3aE0cFDbcf844d3Ae"
    YFI_PROVIDER="0xa3dcfd89481f6Fb20CCAc4D3A997267FC8C44366"
    SNX_PROVIDER="0x77C09829F65E8952dfb80629F6d004DF324f512F"
    OMG_PROVIDER="0x3a1bbd14c1c0e2Ebf7cd906961d122dADd5448A7"
    SUSHI_PROVIDER="0x84D34f4f83a87596Cd3FB6887cFf8F17Bf5A7B83"
    CURVE_AAVE_PROVIDER='0xA1C4Aac752043258c1971463390013e6082C106f'
    AUSDT_V2_PROVIDER='0x2B67A3c0b90f6aE4394210692F69968D02970126'
    ADAI_V2_PROVIDER='0x2f93524B327100Fba3dc685204f94c7A86C28A8B'
    AUSDC_V2_PROVIDER='0x2B67A3c0b90f6aE4394210692F69968D02970126'
    CURVE_ATRICRYPTOCRV_PROVIDER='0x007CB2D47f161620Cd6Ce46fACc1e2F6D5fd6bB9'

    # node_modules/.bin/ganache-cli --gasLimit 0xfffffffffff -m "$TEST_MNEMONIC_PHRASE" > /dev/null &
    node_modules/.bin/ganache-cli --gasLimit 0xfffffffffff --debug -f $POLYGON_MAINNET_NODE -m "$TEST_MNEMONIC_PHRASE" -u "$MATIC_PROVIDER" -u "$WMATIC_PROVIDER" -u "$DAI_PROVIDER" -u "$BAT_PROVIDER" -u "$USDT_PROVIDER" -u "$COMP_PROVIDER" -u "$WBTC_PROVIDER" -u "$YFI_PROVIDER" -u "$OMG_PROVIDER" -u "$SUSHI_PROVIDER" -u "$WETH_PROVIDER" -u "$CURVE_AAVE_PROVIDER" -u "$AUSDT_V2_PROVIDER" -u "$ADAI_V2_PROVIDER" -u "$AUSDC_V2_PROVIDER" -u "$CURVE_ATRICRYPTOCRV_PROVIDER" > /dev/null &

    ganache_pid=$!
}

if ganache_running; then
    echo "Using existing ganache instance"
else
    echo "Starting new ganache instance"
    start_ganache
fi

truffle version

# Execute rest test files with suffix `.test.js` with single `truffle test`
node_modules/.bin/truffle test "$@"
