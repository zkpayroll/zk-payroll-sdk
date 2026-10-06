# Runtime Support Matrix

This document defines the Node.js and browser versions that the ZK Payroll SDK actively supports, along with upgrade policies for dropping old environments.

## Overview

The ZK Payroll SDK is designed to work in both Node.js and browser environments. We maintain a support matrix to ensure compatibility, security, and performance across different runtimes.

## Supported Runtimes

### Node.js

| Status | Version | Support Level | EOL Date |
|--------|---------|---------------|-----------|
| ✅ **Supported** | 20.x LTS | Full Support | April 2026 |
| ✅ **Supported** | 22.x LTS | Full Support | April 2027 |
| ✅ **Supported** | 24.x Current | Full Support | April 2025 |
| ⚠️ **Best Effort** | 18.x LTS | Security Fixes Only | April 2025 |
| ❌ **Unsupported** | < 18.x | No Support | Various |

**Support Levels:**
- **Full Support**: All features tested, bug fixes, security updates
- **Best Effort**: Critical security fixes only, no new features
- **Unsupported**: No updates, may not work correctly

### Browsers

| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome | 90+ | Full support including Web Workers |
| Firefox | 88+ | Full support including Web Workers |
| Safari | 14+ | Full support including Web Workers |
| Edge | 90+ | Full support including Web Workers |
| Opera | 76+ | Full support including Web Workers |

**Browser Requirements:**
- ES2020+ JavaScript support
- Web Workers API support (for off-thread proof generation)
- BigInt support (required for ZK proof witnesses)
- Fetch API support (for circuit artifact loading)
- Typed Arrays support (Uint8Array, ArrayBuffer, etc.)

### Mobile Browsers

| Platform | Minimum Version | Notes |
|----------|----------------|-------|
| iOS Safari | 14+ | Full support |
| Chrome Android | 90+ | Full support |
| Firefox Android | 88+ | Full support |
| Samsung Internet | 14+ | Full support |

## Runtime Features

### Node.js Features

| Feature | Node 18+ | Node 20+ | Node 22+ | Node 24+ |
|---------|----------|----------|----------|----------|
| BigInt | ✅ | ✅ | ✅ | ✅ |
| Fetch API | ✅ | ✅ | ✅ | ✅ |
| Web Workers | ✅ | ✅ | ✅ | ✅ |
| ES Modules | ✅ | ✅ | ✅ | ✅ |
| Worker Threads | ✅ | ✅ | ✅ | ✅ |

### Browser Features

| Feature | Chrome 90+ | Firefox 88+ | Safari 14+ | Edge 90+ |
|---------|------------|-------------|-----------|---------|
| BigInt | ✅ | ✅ | ✅ | ✅ |
| Fetch API | ✅ | ✅ | ✅ | ✅ |
| Web Workers | ✅ | ✅ | ✅ | ✅ |
| ES Modules | ✅ | ✅ | ✅ | ✅ |
| Structured Clone | ✅ | ✅ | ✅ | ✅ |
| Typed Arrays | ✅ | ✅ | ✅ | ✅ |

## CI/CD Coverage

The SDK's continuous integration pipeline tests against the following runtime matrix:

### Node.js CI Matrix

```yaml
node: [20, 22, 24]
target: [node, browser]
```

**Coverage:**
- ✅ Node.js 20.x (LTS) - Node environment tests
- ✅ Node.js 22.x (LTS) - Node environment tests
- ✅ Node.js 24.x (Current) - Node environment tests
- ✅ Node.js 20.x - Browser environment tests (jsdom)
- ✅ Node.js 22.x - Browser environment tests (jsdom)
- ✅ Node.js 24.x - Browser environment tests (jsdom)

### Test Commands

```bash
# Node environment tests
npm run test

# Browser environment tests (jsdom)
npm run test:browser

# Full environment matrix
npm run test:env-matrix
```

## Upgrade Policy

### Node.js Version Support

**Addition Policy:**
- New Node.js LTS versions are added within 1 month of release
- New Node.js Current versions are evaluated for addition

**Deprecation Policy:**
- Node.js versions are deprecated when they reach End-of-Life (EOL)
- Deprecated versions receive security fixes for 3 months after EOL
- After the grace period, support is dropped entirely

**Notification Timeline:**
- **EOL - 6 months**: Deprecation notice in release notes
- **EOL - 3 months**: Warning in documentation
- **EOL**: Security fixes only
- **EOL + 3 months**: Support dropped

### Browser Version Support

**Addition Policy:**
- New browser versions are automatically supported if they maintain feature parity
- No explicit testing needed for minor/patch updates

**Deprecation Policy:**
- Browser versions are deprecated when they fall below minimum version requirements
- Minimum versions are reviewed quarterly
- Deprecated versions may be removed after 6 months

**Feature-Based Deprecation:**
- If a critical feature (e.g., Web Workers, BigInt) is removed from a browser, support for that browser version is dropped immediately

## TypeScript Configuration

The SDK targets ES2020 for maximum compatibility:

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "lib": ["es2020"]
  }
}
```

This ensures:
- BigInt support (ES2020)
- Async/await support
- Optional chaining and nullish coalescing
- Dynamic imports

## Dependency Constraints

### Core Dependencies

| Dependency | Minimum Version | Rationale |
|------------|-----------------|-----------|
| TypeScript | 5.0.0 | Required for ES2020 target |
| Node.js types | 20.0.0 | Matches minimum Node.js version |
| Jest | 29.0.0 | Test framework compatibility |

### ZK Cryptography Dependencies

| Dependency | Version | Notes |
|------------|---------|-------|
| snarkjs | 0.7.5 | ZK proof generation |
| @stellar/stellar-sdk | 14.5.0 | Stellar blockchain interaction |

## Best Effort Support

The following environments may work but are not actively tested or guaranteed:

### Node.js
- Node.js 16.x (EOL September 2023) - May work with polyfills
- Node.js 14.x (EOL April 2023) - May work with polyfills

### Browsers
- Older browser versions with ES2020 polyfills
- IE11 - Not supported (no BigInt, no Web Workers)
- Opera Mini - Not supported (limited feature set)

## Migration Guide

### Upgrading from Unsupported Versions

If you're using an unsupported Node.js version:

1. **Upgrade Node.js** to a supported LTS version:
   ```bash
   # Using nvm (recommended)
   nvm install 20
   nvm use 20
   
   # Or download from nodejs.org
   ```

2. **Update dependencies**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Run tests** to verify compatibility:
   ```bash
   npm run test:env-matrix
   ```

### Browser Compatibility Issues

If you encounter browser compatibility issues:

1. **Check browser version** against the support matrix
2. **Enable required features** (JavaScript, Web Workers)
3. **Use polyfills** for older browsers (not officially supported)
4. **Consider feature detection**:
   ```typescript
   if (typeof BigInt === 'undefined') {
     throw new Error('BigInt is required for ZK proof generation');
   }
   if (typeof Worker === 'undefined') {
     console.warn('Web Workers not available, proof generation may block UI');
   }
   ```

## Reporting Compatibility Issues

When reporting compatibility issues, please include:

1. **Runtime information**:
   - Node.js version (`node --version`)
   - Browser name and version
   - Operating system

2. **SDK version**:
   - `@zk-payroll/sdk` version from package.json

3. **Error details**:
   - Full error message and stack trace
   - Steps to reproduce
   - Expected vs actual behavior

4. **Feature detection** (if browser):
   ```javascript
   console.log({
     userAgent: navigator.userAgent,
     bigInt: typeof BigInt !== 'undefined',
     worker: typeof Worker !== 'undefined',
     fetch typeof fetch !== 'undefined'
   });
   ```

## Future Considerations

### Planned Support Additions

- **Node.js 26.x** - Will be added when it becomes Current
- **Deno** - Evaluation for future support
- **Bun** - Evaluation for future support

### Potential Deprecations

- **Node.js 18.x** - Will be deprecated when it reaches EOL (April 2025)
- **Browser minimum versions** - May be raised based on usage statistics

## Related Documentation

- [Testing Guide](./TESTING.md) - Test environment setup and matrix
- [Worker Compatibility Limitations](./WORKER_COMPATIBILITY_LIMITATIONS.md) - Browser worker-specific limitations
- [Versioning Policy](./VERSIONING.md) - SDK semantic versioning
- [Troubleshooting](./TROUBLESHOOTING.md) - Common environment issues

## Support Policy Questions

For questions about runtime support or upgrade policies:

- Check this documentation first
- Review existing GitHub issues
- Join the [ZK Payroll Telegram group](https://t.me/zkpayroll) for coordination
- Open a GitHub issue for support requests

---

**Last Updated**: July 2026  
**Next Review**: October 2026 (quarterly review of browser minimum versions)
