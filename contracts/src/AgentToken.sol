// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentToken
/// @notice ERC-20 token representing an agent's reputation, priced on a constant-product
///         bonding curve denominated in USDC. Mirrors the pump.fun-style virtual reserve model.
/// @dev    Virtual reserves start the curve at a non-zero price without requiring real liquidity
///         up front. Real USDC only enters the contract as buys happen; it leaves on sells.
contract AgentToken is ERC20, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Total token supply minted to the curve at deployment (1B, 18 decimals)
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000 ether;

    /// @notice Virtual USDC reserve backing the curve at launch (USDC has 6 decimals)
    /// @dev    4,000 USDC virtual reserve => launch market cap of $4,000 at 1B supply
    uint256 public constant VIRTUAL_USDC_RESERVE = 4_000 * 1e6;

    /// @notice Virtual token reserve backing the curve at launch
    uint256 public constant VIRTUAL_TOKEN_RESERVE = TOKEN_SUPPLY;

    /// @notice Constant product k = virtualUsdcReserve * virtualTokenReserve
    uint256 public constant K = VIRTUAL_USDC_RESERVE * VIRTUAL_TOKEN_RESERVE;

    /// @notice Real USDC raised at which the token graduates off the internal curve
    /// @dev    Set low for Arc testnet given limited faucet liquidity. Adjust for mainnet.
    uint256 public constant GRADUATION_THRESHOLD = 4_020 * 1e6;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice USDC token used for all buys/sells
    IERC20 public immutable USDC;

    /// @notice The agent's id in the AgentFactory registry
    bytes32 public immutable AGENT_ID;

    /// @notice Real USDC held by the curve (excludes virtual reserve)
    uint256 public realUsdcReserve;

    /// @notice Tokens currently held by the curve and available to sell
    uint256 public curveTokenBalance;

    /// @notice True once realUsdcReserve has crossed GRADUATION_THRESHOLD
    bool public graduated;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event Bought(
        address indexed buyer,
        uint256 usdcIn,
        uint256 tokensOut,
        uint256 newPrice
    );
    event Sold(
        address indexed seller,
        uint256 tokensIn,
        uint256 usdcOut,
        uint256 newPrice
    );
    event Graduated(uint256 realUsdcReserve);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error AlreadyGraduated();
    error InsufficientOutput();
    error ZeroAmount();
    error InsufficientCurveLiquidity();

    constructor(
        string memory name_,
        string memory symbol_,
        address usdc_,
        bytes32 agentId_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        USDC = IERC20(usdc_);
        AGENT_ID = agentId_;

        // Mint full supply to this contract; the curve sells from its own balance.
        _mint(address(this), TOKEN_SUPPLY);
        curveTokenBalance = TOKEN_SUPPLY;
    }

    // ---------------------------------------------------------------------
    // Curve math
    // ---------------------------------------------------------------------

    /// @notice Current spot price in USDC per whole token (18-decimal token, 6-decimal USDC)
    /// @dev    usdcReserve is in 6-decimal USDC units; tokenReserve is in 18-decimal token units.
    ///         Scale usdcReserve up to 18 decimals (USDC has 6, so multiply by 1e12) before
    ///         dividing, so the result is a clean 18-decimal price-per-token.
    function currentPrice() public view returns (uint256) {
        uint256 usdcReserve = VIRTUAL_USDC_RESERVE + realUsdcReserve;
        uint256 tokenReserve = VIRTUAL_TOKEN_RESERVE -
            (TOKEN_SUPPLY - curveTokenBalance);
        return (usdcReserve * 1e12 * 1 ether) / tokenReserve;
    }

    /// @notice Quote tokens received for a given USDC input, before fees
    function quoteBuy(uint256 usdcIn) public view returns (uint256 tokensOut) {
        uint256 usdcReserve = VIRTUAL_USDC_RESERVE + realUsdcReserve;
        uint256 tokenReserve = VIRTUAL_TOKEN_RESERVE -
            (TOKEN_SUPPLY - curveTokenBalance);

        uint256 newUsdcReserve = usdcReserve + usdcIn;
        uint256 newTokenReserve = K / newUsdcReserve;
        tokensOut = tokenReserve - newTokenReserve;
    }

    /// @notice Quote USDC received for a given token input, before fees
    function quoteSell(uint256 tokensIn) public view returns (uint256 usdcOut) {
        uint256 usdcReserve = VIRTUAL_USDC_RESERVE + realUsdcReserve;
        uint256 tokenReserve = VIRTUAL_TOKEN_RESERVE -
            (TOKEN_SUPPLY - curveTokenBalance);

        uint256 newTokenReserve = tokenReserve + tokensIn;
        uint256 newUsdcReserve = K / newTokenReserve;
        usdcOut = usdcReserve - newUsdcReserve;
    }

    // ---------------------------------------------------------------------
    // Trading
    // ---------------------------------------------------------------------

    /// @notice Buy tokens from the curve with USDC
    /// @param usdcIn        Amount of USDC to spend (6 decimals)
    /// @param minTokensOut  Slippage guard — revert if output is below this
    function buy(
        uint256 usdcIn,
        uint256 minTokensOut
    ) external returns (uint256 tokensOut) {
        if (graduated) revert AlreadyGraduated();
        if (usdcIn == 0) revert ZeroAmount();

        tokensOut = quoteBuy(usdcIn);
        if (tokensOut < minTokensOut) revert InsufficientOutput();
        if (tokensOut > curveTokenBalance) revert InsufficientCurveLiquidity();

        USDC.safeTransferFrom(msg.sender, address(this), usdcIn);

        realUsdcReserve += usdcIn;
        curveTokenBalance -= tokensOut;
        _transfer(address(this), msg.sender, tokensOut);

        emit Bought(msg.sender, usdcIn, tokensOut, currentPrice());

        if (!graduated && realUsdcReserve >= GRADUATION_THRESHOLD) {
            graduated = true;
            emit Graduated(realUsdcReserve);
        }
    }

    /// @notice Sell tokens back to the curve for USDC
    /// @param tokensIn     Amount of tokens to sell (18 decimals)
    /// @param minUsdcOut   Slippage guard — revert if output is below this
    function sell(
        uint256 tokensIn,
        uint256 minUsdcOut
    ) external returns (uint256 usdcOut) {
        if (graduated) revert AlreadyGraduated();
        if (tokensIn == 0) revert ZeroAmount();

        usdcOut = quoteSell(tokensIn);
        if (usdcOut < minUsdcOut) revert InsufficientOutput();
        if (usdcOut > realUsdcReserve) revert InsufficientCurveLiquidity();

        _transfer(msg.sender, address(this), tokensIn);
        curveTokenBalance += tokensIn;
        realUsdcReserve -= usdcOut;

        USDC.safeTransfer(msg.sender, usdcOut);

        emit Sold(msg.sender, tokensIn, usdcOut, currentPrice());
    }

    /// @notice Current fully diluted value in USDC, based on spot price * total supply
    /// @notice Current fully diluted value, in native 6-decimal USDC units
    function fdv() external view returns (uint256) {
        return (currentPrice() * TOKEN_SUPPLY) / 1 ether / 1e12;
    }
}
