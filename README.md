# おうちラジオ（kids-radio）

親が許可したポッドキャストだけを表示・再生する、iPad向けのWebアプリ（PWA）。

## 仕組み

- `allowlist.json` に許可する番組を書く
- GitHub Actions が毎朝5時ごろ（と、push したとき）に各番組のRSSを取得し、アプリといっしょに GitHub Pages へ公開する
- iPad は出来上がった番組リスト（`data/shows.json`）を読むだけ。他の番組を探す・検索する機能はない
- 再生位置・「きいた」の記録・再生速度は、iPad本体にだけ保存される

## 番組の追加・削除

`allowlist.json` の `shows` を編集して push する（GitHubのWeb画面やiPhoneからの編集でOK）。

```json
{
  "maxEpisodesPerShow": 50,
  "hideExplicit": true,
  "shows": [
    { "apple": "https://podcasts.apple.com/jp/podcast/番組名/id1234567890", "memo": "親用メモ" },
    { "feed": "https://example.com/rss.xml", "hideEpisodes": ["タイトルの一部"] }
  ]
}
```

| 項目 | 内容 |
|---|---|
| `apple` | Apple Podcasts の番組ページURL。RSSは自動で調べる |
| `feed` | RSSのURL（分かる場合はこちらが確実） |
| `search` | 番組名（Amazon Musicの番組など）。Apple Podcastsで同じ名前の番組を探す |
| `hideEpisodes` | タイトルにこの文字を含む回は表示しない |
| `maxEpisodes` | 番組ごとの表示数（省略時は `maxEpisodesPerShow`）。`"all"` で全話 |
| `order` | `"oldest"` で1話から順（古い順）に並べる。省略時は新しい順 |
| `memo` | 親用メモ。アプリには出ない |
| `hideExplicit` | 全体設定。「Explicit」指定の回を表示しない |

※ Spotify限定・Amazon限定の番組はRSSがないので追加できない。
※ 取得に失敗した番組は Actions のログに `NG` と出る。

## はじめの設定

1. GitHubに新しいリポジトリ（例：`kids-radio`）を作り、このフォルダの中身を push
2. リポジトリの Settings → Pages → Source を「GitHub Actions」にする
3. Actions タブで `build-and-deploy` が成功したら、表示されたURLを iPad の Safari で開く
4. 共有ボタン →「ホーム画面に追加」

※ 無料プランの GitHub Pages は公開リポジトリが必要。中身は番組リストだけなので公開でも支障は少ないが、検索避けの `noindex` は入れてある。

## iPad側の設定（スクリーンタイム）

- Safari・App Store・Podcast・YouTube などを制限し、おうちラジオだけ使える状態にする
- 小さい子が使うときは「アクセスガイド」でアプリから出られないようにする

## 手元で試す

```sh
npm install
npm run build   # dist/ ができる
npm run serve   # http://localhost:8080
```

## 今後の候補

- 外出先でのオフライン再生が必要になったら、iPadネイティブアプリ（Swift）に移行する。`allowlist.json` と `shows.json` の形式はそのまま使う
