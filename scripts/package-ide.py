"""Package the dependency-free extension as a standard installable VSIX."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'apps/ide-extension'
manifest = json.loads((source / 'package.json').read_text())
output = root / '.ide/zentra-agent.vsix'
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('[Content_Types].xml', '''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="html" ContentType="text/html"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="md" ContentType="text/markdown"/></Types>''')
    archive.writestr('extension.vsixmanifest', f'''<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="zentra-agent" Version="{manifest['version']}" Publisher="zentra-local"/><DisplayName>Zentra — Local Coding Agent</DisplayName><Description xml:space="preserve">Local agent workspace integration.</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>''')
    for file in source.rglob('*'):
        if file.is_file() and 'test' not in file.relative_to(source).parts:
            archive.write(file, 'extension/' + str(file.relative_to(source)))
print(output)
