import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInstallerRequests } from '../src/main/update/installer-requests'
const directory = mkdtempSync(join(tmpdir(), 'zyra-installer-request-'))
try {
    const id = '{12345678-1234-1234-1234-123456789abc}'
    const request = createInstallerRequests(directory)
    assert.equal(request.accept(['--zyra-prepare-update=../other'], '0.7.0'), false)
    assert.equal(request.accept([`--zyra-prepare-update=${id}`], '0.7.0'), false)
    writeFileSync(join(directory, `${id}.request`), '0.8.0-dev.1')
    assert.equal(request.accept([`--zyra-prepare-update=${id}`], '0.7.0'), true)
    assert.equal(request.assertCurrent().version, '0.8.0-dev.1')
    assert.equal(existsSync(join(directory, `${id}.ready`)), false, 'opening the modal cannot authorize the installer')
    request.later()
    assert.equal(existsSync(join(directory, `${id}.later`)), true)
    assert.equal(existsSync(join(directory, `${id}.ready`)), false)
    assert.equal(request.accept([`--zyra-prepare-update=${id}`], '0.7.0'), true)
    request.ready()
    assert.equal(readFileSync(join(directory, `${id}.ready`), 'utf8'), '0.8.0-dev.1')
    const expired = createInstallerRequests(directory, () => Date.now() + 300_000)
    assert.equal(expired.accept([`--zyra-prepare-update=${id}`], '0.7.0'), false)
    console.log('PASS manual installer flag, fixed request directory, version, expiry, explicit Later and quit-only acknowledgment')
} finally { rmSync(directory, { recursive: true, force: true }) }
