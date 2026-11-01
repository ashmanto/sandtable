import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// Strip debug symbols from node-pty's local build so the app doesn't carry the builder's paths.
export default ({ appOutDir, packager }) => {
  const release = join(
    appOutDir,
    `${packager.appInfo.productFilename}.app`,
    'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release'
  )
  for (const file of ['pty.node', 'spawn-helper'])
    execFileSync('strip', ['-S', join(release, file)], { stdio: 'pipe' })
}
