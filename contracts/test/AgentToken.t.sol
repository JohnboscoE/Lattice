// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AgentToken} from "../src/AgentToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AgentTokenTest is Test {
    AgentToken token;
    MockUSDC usdc;

    address owner = address(0xA11CE);
    address buyer = address(0xB0B);
    address buyer2 = address(0xC0C);

    bytes32 constant AGENT_ID = keccak256("scribe-7");

    function setUp() public {
        usdc = new MockUSDC();
        token = new AgentToken("Scribe-7", "SCRB7", address(usdc), AGENT_ID, owner);

        usdc.mint(buyer, 1_000_000 * 1e6);
        usdc.mint(buyer2, 1_000_000 * 1e6);

        vm.prank(buyer);
        usdc.approve(address(token), type(uint256).max);

        vm.prank(buyer2);
        usdc.approve(address(token), type(uint256).max);
    }

    // -------------------------------------------------------------------
    // Deployment invariants
    // -------------------------------------------------------------------

    function test_initialSupplyMintedToCurve() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(token)), 1_000_000_000 ether);
        assertEq(token.curveTokenBalance(), 1_000_000_000 ether);
    }

    function test_initialPriceMatchesFourThousandMarketCap() public view {
        // price * 1B tokens should equal ~$4,000 at launch
        uint256 price = token.currentPrice(); // USDC per whole token, scaled 1e18
        uint256 impliedMcap = (price * 1_000_000_000) / 1e12; // back to USDC units (6 decimals)
        // $4,000 USDC = 4_000 * 1e6
        assertApproxEqAbs(impliedMcap, 4_000 * 1e6, 1e6); // within $1 rounding tolerance
    }

    function test_fdvAtLaunchIsFourThousand() public view {
        uint256 fdv = token.fdv();
        assertApproxEqAbs(fdv, 4_000 * 1e6, 1e6);
    }

    // -------------------------------------------------------------------
    // Buy behavior
    // -------------------------------------------------------------------

    function test_buyIncreasesPriceMonotonically() public {
        uint256 priceBefore = token.currentPrice();

        vm.prank(buyer);
        token.buy(4 * 1e6, 0); // $4 USDC, matches the original "1.04" scenario discussed

        uint256 priceAfter = token.currentPrice();
        assertGt(priceAfter, priceBefore, "price must increase after a buy");
    }

    function test_buyGivesExpectedTokensViaConstantProduct() public {
        uint256 usdcIn = 100 * 1e6; // $100
        uint256 expectedOut = token.quoteBuy(usdcIn);

        vm.prank(buyer);
        uint256 actualOut = token.buy(usdcIn, 0);

        assertEq(actualOut, expectedOut);
        assertEq(token.balanceOf(buyer), expectedOut);
    }

    function test_buyRevertsOnZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(AgentToken.ZeroAmount.selector);
        token.buy(0, 0);
    }

    function test_buyRevertsWhenSlippageExceeded() public {
        uint256 usdcIn = 100 * 1e6;
        uint256 quoted = token.quoteBuy(usdcIn);

        vm.prank(buyer);
        vm.expectRevert(AgentToken.InsufficientOutput.selector);
        token.buy(usdcIn, quoted + 1); // demand more than the curve will give
    }

    function test_buyTransfersUsdcIntoContract() public {
        uint256 usdcIn = 50 * 1e6;
        uint256 contractBalBefore = usdc.balanceOf(address(token));

        vm.prank(buyer);
        token.buy(usdcIn, 0);

        assertEq(usdc.balanceOf(address(token)), contractBalBefore + usdcIn);
        assertEq(token.realUsdcReserve(), usdcIn);
    }

    // -------------------------------------------------------------------
    // Sell behavior
    // -------------------------------------------------------------------

    function test_sellReturnsUsdcAndDecreasesPrice() public {
        vm.prank(buyer);
        uint256 tokensOut = token.buy(100 * 1e6, 0);

        uint256 priceBeforeSell = token.currentPrice();

        vm.prank(buyer);
        token.sell(tokensOut, 0);

        uint256 priceAfterSell = token.currentPrice();
        assertLt(priceAfterSell, priceBeforeSell, "price must decrease after a sell");
    }

    function test_sellRoundTripLosesNothingToRoundingBeyondDust() public {
        uint256 usdcIn = 100 * 1e6;

        vm.startPrank(buyer);
        uint256 usdcBalBefore = usdc.balanceOf(buyer);
        uint256 tokensOut = token.buy(usdcIn, 0);
        uint256 usdcOut = token.sell(tokensOut, 0);
        vm.stopPrank();

        // Buying then immediately selling the same amount should return ~ the same USDC
        // (exactly equal, since no fees are charged in this version of the curve)
        assertEq(usdcOut, usdcIn);
        assertEq(usdc.balanceOf(buyer), usdcBalBefore);
    }

    function test_sellRevertsOnZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert(AgentToken.ZeroAmount.selector);
        token.sell(0, 0);
    }

    function test_sellRevertsWhenSlippageExceeded() public {
        vm.prank(buyer);
        uint256 tokensOut = token.buy(100 * 1e6, 0);

        uint256 quoted = token.quoteSell(tokensOut);

        vm.prank(buyer);
        vm.expectRevert(AgentToken.InsufficientOutput.selector);
        token.sell(tokensOut, quoted + 1);
    }

    // -------------------------------------------------------------------
    // Graduation
    // -------------------------------------------------------------------

    function test_graduatesWhenThresholdCrossed() public {
        assertFalse(token.graduated());

        vm.prank(buyer);
        token.buy(4_020 * 1e6, 0);

        assertTrue(token.graduated());
    }

    function test_buyRevertsAfterGraduation() public {
        vm.prank(buyer);
        token.buy(4_020 * 1e6, 0);
        assertTrue(token.graduated());

        vm.prank(buyer2);
        vm.expectRevert(AgentToken.AlreadyGraduated.selector);
        token.buy(10 * 1e6, 0);
    }

    function test_sellRevertsAfterGraduation() public {
        vm.prank(buyer);
        uint256 tokensOut = token.buy(4_020 * 1e6, 0);
        assertTrue(token.graduated());

        vm.prank(buyer);
        vm.expectRevert(AgentToken.AlreadyGraduated.selector);
        token.sell(tokensOut, 0);
    }

    function test_doesNotGraduateBelowThreshold() public {
        vm.prank(buyer);
        token.buy(4_019 * 1e6, 0);
        assertFalse(token.graduated());
    }

    // -------------------------------------------------------------------
    // Multi-buyer interaction
    // -------------------------------------------------------------------

    function test_secondBuyerPaysMoreForSameTokenAmountAfterFirstBuy() public {
        vm.prank(buyer);
        token.buy(500 * 1e6, 0);

        uint256 priceAfterFirstBuy = token.currentPrice();

        vm.prank(buyer2);
        token.buy(500 * 1e6, 0);

        uint256 priceAfterSecondBuy = token.currentPrice();

        assertGt(priceAfterSecondBuy, priceAfterFirstBuy);
    }

    function test_curveTokenBalanceDecreasesAsTokensAreBought() public {
        uint256 balBefore = token.curveTokenBalance();

        vm.prank(buyer);
        uint256 tokensOut = token.buy(100 * 1e6, 0);

        assertEq(token.curveTokenBalance(), balBefore - tokensOut);
    }
}
