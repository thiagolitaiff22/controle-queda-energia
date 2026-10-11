#!/bin/bash
# Gera o aplicativo do prospectador (.apk assinado) e publica em app/download/ para os celulares baixarem.
# Antes de gerar uma versão nova: aumente APP_VERSAO no campo.html (e versionCode em android/app/build.gradle).
# Ferramentas (Java e Android SDK) e a chave de assinatura ficam em C:\Users\Admin\android-tools (fora do repositório).
set -e
cd "$(dirname "$0")"
T=/c/Users/Admin/android-tools
export JAVA_HOME="$(cygpath -w "$(ls -d $T/jdk/*/ | head -1)")" ANDROID_HOME="$(cygpath -w $T/sdk)"
node montar.js
npx cap sync android > /dev/null
(cd android && ./gradlew.bat assembleRelease --no-daemon -q 2>&1 | grep -iv "warning\|deprecat\|unchecked\|Xlint" || true)
V=$(grep -o 'var APP_VERSAO = [0-9]*' ../campo.html | grep -o '[0-9]*$')
mkdir -p download
cp android/app/build/outputs/apk/release/app-release.apk download/cadastro-ambar.apk
printf '{"versao": %s, "url": "https://thiagolitaiff22.github.io/controle-queda-energia/app/download/cadastro-ambar.apk"}\n' "$V" > versao.json
"$T/sdk/build-tools/35.0.0/apksigner.bat" verify --print-certs download/cadastro-ambar.apk | grep -i "signer #1 certificate DN"
echo "APK pronto: app/download/cadastro-ambar.apk (versão $V)"
