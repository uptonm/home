import { runConfigure } from '../../core/configure'
import manifest from './index'

export const configureUnifi = () => runConfigure(manifest)
