const { network } = require("hardhat");
const { developmentChains, networkConfig } = require("../helper-hardhat-config");
const { verify } = require("../utils/verify");

const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther("30");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deploy, log } = deployments;
    const { deployer } = await getNamedAccounts();
    const chainId = network.config.chainId;
    let vrfCoordinatorV2Address;
    let subscriptionId;
    let vrfCoordinatorV2Mock;

    if (developmentChains.includes(network.name)) {
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock");
        vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address;
        const txResp = await vrfCoordinatorV2Mock.createSubscription(); //it sends the subscription id inside an event
        const txReceipt = await txResp.wait(1);
        subscriptionId = txReceipt.events[0].args.subId;
        //Fund the subscription
        //usually, you would need the link token on a real network
        await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT);
    } else {
        vrfCoordinatorV2Address = networkConfig[chainId]["vrfCoordinatorV2"];
        subscriptionId = networkConfig[chainId]["subscriptionId"];
    }

    const entranceFee = networkConfig[chainId]["entranceFee"];
    const gasLane = networkConfig[chainId]["gasLane"];
    const callbackGasLimit = networkConfig[chainId]["callbackGasLimit"];
    const interval = networkConfig[chainId]["interval"];

    const args = [
        vrfCoordinatorV2Address,
        entranceFee,
        gasLane,
        subscriptionId,
        callbackGasLimit,
        interval,
    ];
    const raffle = await deploy("Raffle", {
        from: deployer,
        args: args,
        log: true,
        waitConfirmations: network.config.blockConfirmations || 1,
    });

    if (developmentChains.includes(network.name)) {
        log("Register the raffle contract as consumer in the VRF Mock..");
        // register our raffle contract as a consumer in the VRF mock contract
        await vrfCoordinatorV2Mock.addConsumer(subscriptionId, raffle.address);
    }

    if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
        await verify(raffle.address, args);
    }

    log("---------------------------------------------------");
};

module.exports.tags = ["all", "raffle"];
