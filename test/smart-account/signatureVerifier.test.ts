import hre from "hardhat"
import { expect } from "chai"
import { SignatureVerifier } from "../../typechain-types"

describe("SignatureVerifier", function () {
  let signatureVerifier: SignatureVerifier
  beforeEach(async function () {
    const SignatureVerifier =
      await hre.ethers.getContractFactory("SignatureVerifier")
    signatureVerifier = await SignatureVerifier.deploy()
  })

  it("Should set the right unlockTime", async function () {
    expect(true).to.equal(true)
  })
})
