/**
 * The web app against real headless registry hosts, with no Nyte account:
 * Address and Token, Add Folder on Host, Trust Folder, Files, the first
 * message, and the first message's answer lost on the wire. Every step in
 * the browser goes through its UI; what the host holds is read from the host.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, README_LINE, test } from "./fixtures.ts";
import type { RegistryHost } from "./fixtures.ts";

const IDENTITY_CHANGED =
  "This address answers with a different host identity than the one you paired with. Pair again only if you replaced or reinstalled that host.";

const AcceptedReply = Type.Object({
  value: Type.Object({ kind: Type.Literal("accepted"), sessionId: Type.String() }),
});

function composer(page: Page): Locator {
  return page.getByRole("form", { name: "Message composer" });
}

function pane(page: Page): Locator {
  return page.getByRole("region", { name: "Active chat pane" });
}

/** The blank pane's notice for a start the host never answered. */
function unconfirmed(page: Page, message: string): Locator {
  return page
    .getByRole("alert")
    .filter({ hasText: `The host didn’t confirm this chat: “${message}”` });
}

function sessionIdOf(url: string): string {
  const match = /\/session\/([^/?#]+)$/u.exec(new URL(url).pathname);

  if (match?.[1] === undefined) throw new Error(`Not a chat URL: ${url}`);

  return decodeURIComponent(match[1]);
}

/**
 * The next start reaches the host, which accepts it, and the browser never
 * hears back. Resolves with the chat the host started.
 */
async function loseNextStartAnswer(
  page: Page,
  host: RegistryHost,
): Promise<{ readonly accepted: Promise<string> }> {
  let settle: { resolve: (id: string) => void; reject: (cause: unknown) => void } | undefined;

  const accepted = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  await page.route(
    (url) => url.href === `${host.address}/v1/call/environment.start`,
    async (route) => {
      try {
        const reply: unknown = await (await route.fetch()).json();
        await route.abort("connectionreset");

        if (!Value.Check(AcceptedReply, reply))
          throw new Error(`The host did not accept: ${JSON.stringify(reply)}`);
        settle?.resolve(reply.value.sessionId);
      } catch (cause) {
        settle?.reject(cause);
      }
    },
    { times: 1 },
  );

  return { accepted };
}

async function connect(page: Page, host: RegistryHost): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to a Desktop" }),
    "the app must be built without VITE_NYTE_CLERK_PUBLISHABLE_KEY",
  ).toBeVisible();
  await page.getByLabel("Address").fill(host.address);
  await page.getByLabel("Token").fill(host.token);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(composer(page)).toBeVisible();
}

/** The new chat's workspace selector, named for the folder it shows. */
function workspaceSelector(page: Page, selected: string): Locator {
  return pane(page).getByRole("button", { name: selected, exact: true });
}

/** Open Folder… from the workspace selector, currently named `selected`; resolves to the trust prompt. */
async function addFolder(page: Page, selected: string, path: string): Promise<Locator> {
  await workspaceSelector(page, selected).click();
  await page.getByRole("menuitem", { name: "Open Folder…" }).click();
  const prompt = page.getByRole("dialog", { name: "Add Folder on Host" });
  await prompt.getByLabel("Full path on the host").fill(path);
  await prompt.getByRole("button", { name: "Add Folder" }).click();
  await expect(prompt).toBeHidden();
  const trust = page.getByRole("dialog", { name: "Trust Folder" });
  await expect(trust).toBeVisible();

  return trust;
}

async function folderOn(host: RegistryHost, path: string) {
  const folder = (await host.state()).folders.find((row) => row.path === path);

  if (folder === undefined) throw new Error(`${path} is not registered on the host`);

  return folder;
}

/** The prompt names the host and the path; Trust Folder grants the folder as it was when the prompt opened. */
async function trustShown(host: RegistryHost, prompt: Locator, path: string) {
  const shown = await folderOn(host, path);
  await expect(prompt).toContainText(path);
  await expect(prompt).toContainText(host.hostId);
  await prompt.getByRole("button", { name: "Trust Folder" }).click();
  await expect(prompt).toBeHidden();
  await expect.poll(async () => folderOn(host, path)).toEqual({ ...shown, trust: "granted" });
}

async function send(page: Page, text: string): Promise<void> {
  const message = page.getByLabel("Message", { exact: true });
  await message.fill(text);
  await message.press("Enter");
}

test("a browser connects to a headless host by address, works in a host folder it trusted, and keeps its chat across a reload", async ({
  page,
  hosts,
  problems,
}) => {
  const host = await hosts.start();
  const { project } = hosts.folders;
  const files = page.getByRole("region", { name: "Files" });

  await test.step("Address and Token connect, and a reload reconnects to the same host", async () => {
    await connect(page, host);
    await page.reload();
    await expect(composer(page)).toBeVisible();
  });

  await test.step("Add Folder registers the host path and Trust Folder grants what it showed", async () => {
    await trustShown(host, await addFolder(page, "Home", project), project);
    await expect(workspaceSelector(page, "project")).toBeVisible();
  });

  await test.step("Files reads the README from the host folder", async () => {
    await page
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button", { name: "Files", exact: true })
      .click();
    await files.getByRole("button", { name: "Show Explorer", exact: true }).click();
    await files.getByRole("treeitem", { name: /README\.md/u }).click();
    await expect(files.getByText(README_LINE, { exact: true })).toBeVisible();
  });

  await test.step("the first message starts one chat in that folder and the host answers", async () => {
    await send(page, "hello host");
    await expect(pane(page).getByText("Echo: hello host", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/session\/[^/?#]+$/u);
    expect((await host.state()).roots).toEqual([
      { sessionId: sessionIdOf(page.url()), cwd: project },
    ]);
  });

  await test.step("a reload opens the same chat, and the host still has one", async () => {
    const chat = page.url();
    await page.reload();
    await expect(page).toHaveURL(chat);
    await expect(pane(page).getByText("Echo: hello host", { exact: true })).toBeVisible();
    expect((await host.state()).roots).toEqual([{ sessionId: sessionIdOf(chat), cwd: project }]);
  });

  expect(problems).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("an accepted first message whose answer is lost starts one chat when retried", async ({
  page,
  hosts,
  problems,
}) => {
  const host = await hosts.start();
  const { project } = hosts.folders;
  await connect(page, host);
  await trustShown(host, await addFolder(page, "Home", project), project);

  const { accepted } = await loseNextStartAnswer(page, host);
  await send(page, "hello once");
  const started = await accepted;
  await expect(unconfirmed(page, "hello once")).toBeVisible();
  expect((await host.state()).roots).toEqual([{ sessionId: started, cwd: project }]);

  await unconfirmed(page, "hello once").getByRole("button", { name: "Retry" }).click();
  await expect(pane(page).getByText("Echo: hello once", { exact: true })).toBeVisible();
  expect(sessionIdOf(page.url())).toBe(started);
  expect((await host.state()).roots).toEqual([{ sessionId: started, cwd: project }]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([expect.stringContaining("ERR_CONNECTION_RESET")]);
});

test("a lost first message keeps its folder when the selection moves before the retry", async ({
  page,
  hosts,
  problems,
}) => {
  const host = await hosts.start();
  const { project, other } = hosts.folders;
  await connect(page, host);
  await trustShown(host, await addFolder(page, "Home", other), other);
  await trustShown(host, await addFolder(page, "other", project), project);

  const { accepted } = await loseNextStartAnswer(page, host);
  await send(page, "hello project");
  const started = await accepted;
  await expect(unconfirmed(page, "hello project")).toBeVisible();

  await workspaceSelector(page, "project").click();
  await page.getByRole("menuitemradio", { name: "other" }).click();
  await expect(workspaceSelector(page, "other")).toBeVisible();

  await unconfirmed(page, "hello project").getByRole("button", { name: "Retry" }).click();
  await expect(pane(page).getByText("Echo: hello project", { exact: true })).toBeVisible();
  expect(sessionIdOf(page.url())).toBe(started);
  expect((await host.state()).roots).toEqual([{ sessionId: started, cwd: project }]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([expect.stringContaining("ERR_CONNECTION_RESET")]);
});

test("a reload after a lost first message finds the one chat the host started", async ({
  page,
  hosts,
  problems,
}) => {
  const host = await hosts.start();
  const { project } = hosts.folders;
  await connect(page, host);
  await trustShown(host, await addFolder(page, "Home", project), project);

  const { accepted } = await loseNextStartAnswer(page, host);
  await send(page, "hello after reload");
  const started = await accepted;
  await expect(unconfirmed(page, "hello after reload")).toBeVisible();

  // The browser asks the host about the start it never heard back on, and offers the chat it finds.
  await page.reload();
  await expect(page.getByText("Chat started", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(pane(page).getByText("Echo: hello after reload", { exact: true })).toBeVisible();
  expect(sessionIdOf(page.url())).toBe(started);
  expect((await host.state()).roots).toEqual([{ sessionId: started, cwd: project }]);
  expect(problems.pageErrors).toEqual([]);
  expect(problems.consoleErrors).toEqual([expect.stringContaining("ERR_CONNECTION_RESET")]);
});

test("a folder replaced while Trust Folder is open is not trusted until a new prompt shows it", async ({
  page,
  hosts,
  problems,
}) => {
  const host = await hosts.start();
  const { project } = hosts.folders;
  await connect(page, host);
  const prompt = await addFolder(page, "Home", project);
  const shown = await folderOn(host, project);

  await rename(project, `${project}-before`);
  await mkdir(join(project, ".nyte", "plugins"), { recursive: true });
  await writeFile(join(project, "README.md"), "# Replacement\n");
  const replaced = await folderOn(host, project);
  expect(replaced).toEqual({ ...shown, identity: expect.any(String), trust: "changed" });

  // The open prompt showed the folder that is gone; confirming it grants nothing.
  await prompt.getByRole("button", { name: "Trust Folder" }).click();
  await expect(page.getByText(/changed on the host/u)).toBeVisible();
  expect(await folderOn(host, project)).toEqual(replaced);

  // Nothing was selected while it asked; only a new prompt, opened on the replacement, can grant it.
  await trustShown(host, await addFolder(page, "Home", project), project);
  expect(problems).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a saved address that answers with another host key is refused before any call until Pair as New Host", async ({
  page,
  hosts,
  problems,
}) => {
  const paired = await hosts.start();
  await connect(page, paired);

  // The same address and bearer, a new key: the profile's identity is gone when it opens again.
  await paired.stop();
  await rm(join(paired.home, "hosts", "default", "identity.json"));

  const replaced = await hosts.start({
    home: paired.home,
    port: Number(new URL(paired.address).port),
  });

  expect(replaced.address).toBe(paired.address);
  expect(replaced.hostId).not.toBe(paired.hostId);

  const reached: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(replaced.address)) reached.push(new URL(request.url()).pathname);
  });

  const refusal = page.getByRole("alert").filter({ hasText: IDENTITY_CHANGED });
  const retry = page.getByRole("button", { name: "Connect", exact: true });
  await page.reload();
  await expect(refusal).toHaveText(IDENTITY_CHANGED);
  await expect(composer(page)).toBeHidden();

  // Connect asks again with the pin; the form comes back refused instead of opening the shell.
  const asked = page.waitForResponse(`${replaced.address}/v1/info`);
  await retry.click();
  await asked;
  await expect(retry).toBeEnabled();
  await expect(refusal).toHaveText(IDENTITY_CHANGED);
  expect(reached.filter((path) => path !== "/v1/info" && path !== "/v1/identity")).toEqual([]);

  // Only the explicit re-pair adopts the new key; after it the browser works with this host and keeps it.
  await page.getByRole("button", { name: "Pair as New Host" }).click();
  await expect(composer(page)).toBeVisible();
  expect(reached).toContainEqual(expect.stringMatching(/^\/v1\/call\//u));
  await page.reload();
  await expect(composer(page)).toBeVisible();
  await expect(refusal).toBeHidden();
  expect(problems.pageErrors).toEqual([]);
});
