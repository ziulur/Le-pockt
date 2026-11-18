# Como montar o LE Pocket

Tudo sai de `src/`. Nunca edite `index.html`, `sw.js` ou `web/index.html` direto: eles são gerados.

## Estrutura

| Pasta | O que tem |
|---|---|
| `src/ui.html` | interface (tela, controles, som, biblioteca, saves) com três marcadores que o build preenche |
| `src/cores/` | núcleos: `gbcore.js` (GB/GBC), `gba.js`, `armcpu.js`, `nds.js`, `nds3d.js`, `ndssnd.js` |
| `src/assets/` | ícones |
| `src/platform/windows/` | instalador e leia-me do Windows |
| `tools/build.py` | montagem (só Python 3, sem bibliotecas extras) |
| `tests/run-all.js` | testes de regressão (Node 22) |
| `tests/fixtures/` | programas de teste próprios (nenhum jogo comercial); fontes em `tests/fixtures-src/` |
| `android/`, `ios/` | cascas nativas que embutem `dist/web/LE-Pocket.html` |

## Fluxo

```
src/  ->  tools/build.py  ->  dist/web/LE-Pocket.html  ->  android/ (assets/index.html), ios/ (www/index.html), Windows, release
                          ->  dist/pwa/                ->  raiz do repositório (GitHub Pages) com --publish
                          ->  dist/windows/
```

## Comandos

```sh
python3 tools/build.py            # gera dist/ (falha se faltar arquivo)
node tests/run-all.js             # testes; código de saída 1 se algum falhar
python3 tools/build.py --publish  # atualiza a raiz (site) e web/ a partir de dist/
python3 tools/build.py --check    # falha se a raiz/web/ estiverem diferentes de src/
```

Android (precisa de JDK 17 e Gradle 8.9):
```sh
mkdir -p android/app/src/main/assets && cp dist/web/LE-Pocket.html android/app/src/main/assets/index.html
gradle -p android assembleDebug
```

iPhone (precisa de Mac com Xcode e XcodeGen):
```sh
mkdir -p ios/www && cp dist/web/LE-Pocket.html ios/www/index.html
cd ios && xcodegen generate && xcodebuild -project LEPocket.xcodeproj -scheme LEPocket -configuration Release -sdk iphoneos CODE_SIGNING_ALLOWED=NO build
```

Programas de teste (só para recriar `tests/fixtures/`; precisa de clang, ld.lld, llvm-objcopy):
```sh
sh tests/fixtures-src/gba/build.sh
sh tests/fixtures-src/nds/build.sh
node tests/fixtures-src/gb-demo-mkrom.js   # gera demo.gb na pasta atual
```

## No GitHub (`.github/workflows/montar.yml`)

1. `web`: build com `--check`, testes, lista do que foi gerado, pacote do Windows.
2. `android` e `ios`: usam o `dist/web/LE-Pocket.html` do passo 1 (o mesmo arquivo testado).
3. `publicar`: só na `main` e só se tudo acima passou. Publica APK, IPA, ZIP do Windows e HTML.

Pull requests rodam build e testes, mas não publicam nada. Se a máquina Mac do GitHub não estiver disponível, a publicação sai com o APK novo e mantém o IPA anterior.

## Limites conhecidos

- O APK é de depuração (debug), sem assinatura de loja.
- O IPA sai sem assinatura; precisa de uma ferramenta que assine para instalar.
- Nada disso foi testado automaticamente em aparelho real.
