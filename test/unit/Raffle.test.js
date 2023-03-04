const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", () => {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
          const chainId = network.config.chainId;

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              raffleEntranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("constructor", () => {
              it("initializes the raffle correctly", async () => {
                  //Ideally we make our tests have just 1 assert per "it"
                  const raffleState = await raffle.getRaffleState();
                  assert.equal(raffleState.toString(), "0");
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
              });
          });

          describe("enterRaffle", () => {
              it("reverts when you don't pay enough", async () => {
                  await expect(raffle.enterRaffle).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  );
              });

              it("records players when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const playerFromContract = await raffle.getPlayer(0);
                  assert.equal(playerFromContract, deployer);
              });

              it("emits event on enter", async () => {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  );
              });

              it("doesn't allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  //pretend to be a chainlink keeper
                  await raffle.performUpkeep([]);
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  );
              });
          });

          describe("checkUpkeep", () => {
              it("returns false if people haven't sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });

              it("returns false if raffle isn't open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep("0x");
                  const raffleState = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert.equal(raffleState.toString(), "1");
                  assert.equal(upkeepNeeded, false);
              });

              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]); // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(!upkeepNeeded);
              });
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(upkeepNeeded);
              });
          });

          describe("performUpkeep", () => {
              it("it can only run if checkupkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const tx = await raffle.performUpkeep([]);
                  assert(tx);
              });

              it("reverts when checkupkeep is false", async () => {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  );
              });

              it("updates the raffle state, emits an event and calls the vrf coordinator", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const txResp = await raffle.performUpkeep("0x");
                  const txReceipt = await txResp.wait(1);
                  // it is the second event emitted since requestRandomWords itself emits another event
                  const requestId = txReceipt.events[1].args.requestId;
                  const raffleState = await raffle.getRaffleState();
                  assert(requestId.toNumber() > 0);
                  assert(raffleState.toString() == "1");
              });
          });

          describe("fulfillRandomWords", () => {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
              });

              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request");

                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request");
              });

              it("picks a winner, resets the lottery, and sends money", async () => {
                  const additionalEntrants = 3;
                  const startingAccountIndex = 1; //deployer is 0
                  const accounts = await ethers.getSigners();
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i]);
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                  }

                  const startingTimeStamp = await raffle.getLatestTimeStamp();
                  // performUpkeep (mock being chainlink keepers)
                  // fulfillRandomWords (mock being the chainlink VRF)
                  // We will have to wait for fulfillRandomWords to be called
                  await new Promise(async (resolve, reject) => {
                      // setup the event listener
                      raffle.once("WinnerPicked", async () => {
                          console.log("Found the event!");
                          try {
                              const recentWinner = await raffle.getRecentWinner();
                              // second account is the winner
                              const winnerEndingBalance = await accounts[1].getBalance();

                              const raffleState = await raffle.getRaffleState();
                              const endingTimeStamp = await raffle.getLatestTimeStamp();
                              const numPlayers = await raffle.getNumberOfPlayers();
                              assert.equal(numPlayers.toString(), "0");
                              assert.equal(raffleState.toString(), "0");
                              assert(endingTimeStamp > startingTimeStamp);

                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString()
                              );
                          } catch (e) {
                              reject(e);
                          }
                          resolve();
                      });
                      // we will fire the event and the listener above will pick it up
                      const tx = await raffle.performUpkeep([]);
                      const txReceipt = await tx.wait(1);
                      const winnerStartingBalance = await accounts[1].getBalance();
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      );
                  });
              });
          });
      });
