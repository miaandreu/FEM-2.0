# What is left for you to do by hand

1. **Put the code on GitHub without the command line.** Two options:
   * **GitHub Desktop** (no git commands needed): copy the project files (everything except `node_modules` and `dist`)
     into your cloned repository folder, open GitHub Desktop, select the repository, write a summary such as
     "FEM frame learning tool" in the box at the bottom left, click **Commit to main**, then **Push origin**.
   * **Browser upload:** on the repository page choose **Add file → Upload files** and drag the files in (not `node_modules`
     or `dist`). Hidden folders such as `.github` may not upload this way; if `.github/workflows/deploy.yml` is missing,
     use **Add file → Create new file**, type `.github/workflows/deploy.yml` as the name and paste the file's contents.
   Make the repository public, or use a plan that allows Pages for private repositories.
2. **Turn on Pages:** repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then open
   **Actions**, wait for "Deploy to GitHub Pages" to turn green (re-run it if it ran before you changed the setting),
   and open the link it prints: `https://<you>.github.io/<repo>/`.
3. **Open the live link yourself** and click through: each example in the Examples menu (A–E), Next through all 11 steps,
   rotate the 3D view, and try it on your phone.
4. **Write your own AI-disclosure sentences** in `AI_DISCLOSURE.md` (the marked spot) and check that the draft is true for how you worked.
5. **Record a short demo** (optional but useful): load Example A, step through, then Example D.
6. **Run the checks once on your own machine:** `npm install && npm test && npm run build`.
7. **Submit:** the link, `USER_GUIDE.md`, the repository (source), and `AI_DISCLOSURE.md`.

Things I could not verify for you: the deployed site itself, behaviour on a real phone, and use with a screen reader.
