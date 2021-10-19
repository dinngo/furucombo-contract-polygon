# npm install

hardhat_port=8545

hardhat_running() {
    nc -z localhost "$hardhat_port"
}

echo '1----'
hardhat_running 
echo '2----'
echo $( nc -z localhost "$hardhat_port" )
echo '3----'

if hardhat_running; then
    echo "Using existing hardhat network instance"
else
    echo "Starting new hardhat network instance"
fi

while ! hardhat_running
do 
        echo "wait hardhat network launching...might take some time if doing migration script."
        sleep 3
done


