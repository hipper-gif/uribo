/** tkcImportCli.ts を jiti(TypeScriptランタイムローダー)経由で実行するブートストラップ。
 *  jiti は vite の依存として node_modules に既にあるため追加インストール不要。
 *  実行: npm run tkc-import -- --csv <path> [--apply]
 */
import { createJiti } from 'jiti'

const jiti = createJiti(import.meta.url)
await jiti.import('./tkcImportCli.ts')
