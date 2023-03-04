const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Staging Tests", () => {
          let raffle, raffleEntranceFee, deployer;

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer;
              raffle = await ethers.getContract("Raffle", deployer);
              raffleEntranceFee = await raffle.getEntranceFee();
          });

          describe("fulfillRandomWords", () => {
              it("works with live chainlink keepers and chainlink VRF, we get a random winner", async () => {
                  const startingTimeStamp = await raffle.getLatestTimeStamp();
                  const accounts = await ethers.getSigners();
                  // setup listener before we enter the raffle
                  // just in case the blockchain moves really fast
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          console.log("WinnerPicked event fired!");
                          try {
                              const recentWinner = await raffle.getRecentWinner();
                              const raffleState = await raffle.getRaffleState();
                              const winnerEndingBalace = await accounts[0].getBalance();
                              const endingTimeStamp = await raffle.getLatestTimeStamp();

                              await expect(raffle.getPlayer(0)).to.be.reverted;
                              assert.equal(recentWinner.toString(), accounts[0].address);
                              assert.equal(raffleState.toString(), "0");
                              assert.equal(
                                  winnerEndingBalace.toString(),
                                  winnerStartingBalance.add(raffleEntranceFee).toString()
                              );
                              assert(endingTimeStamp > startingTimeStamp);

                              resolve();
                          } catch (error) {
                              console.log(error);
                              reject(error);
                          }
                      });

                      console.log("Entered the Raffle..");
                      const tx = await raffle.enterRaffle({ value: raffleEntranceFee });
                      await tx.wait(1);
                      console.log("Time to wait..");
                      const winnerStartingBalance = await accounts[0].getBalance();
                      //console.log(`starting balance ${winnerStartingBalance.toString()}`);
                  });
              });
          });
      });
