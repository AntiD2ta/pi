import { Chalk } from "chalk";
import {
	Markdown,
	type MarkdownCodeFenceContext,
	type MarkdownCodeFenceChrome,
	type MarkdownTheme,
	ProcessTerminal,
	Spacer,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "../src/index.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

const chalk = new Chalk({ level: 3 });

const theme: MarkdownTheme = {
	heading: (text) => chalk.bold.cyan(text),
	link: (text) => chalk.blue(text),
	linkUrl: (text) => chalk.dim(text),
	code: (text) => chalk.yellow(text),
	codeBlock: (text) => chalk.green(text),
	codeBlockBorder: (text) => chalk.dim(text),
	quote: (text) => chalk.italic(text),
	quoteBorder: (text) => chalk.dim(text),
	hr: (text) => chalk.dim(text),
	listBullet: (text) => chalk.cyan(text),
	bold: (text) => chalk.bold(text),
	italic: (text) => chalk.italic(text),
	strikethrough: (text) => chalk.strikethrough(text),
	underline: (text) => chalk.underline(text),
	highlightCode: (code) => code.split("\n").map((line) => chalk.green(line)),
};

function fenceTitle(context: MarkdownCodeFenceContext): string {
	return [context.language, context.path].filter(Boolean).join("  ") || "code";
}

const chrome: MarkdownCodeFenceChrome = {
	header: (context) => {
		const innerWidth = Math.max(1, context.width - 2);
		const title = truncateToWidth(` ${fenceTitle(context)} `, innerWidth);
		return [`╭${"─".repeat(innerWidth)}╮`, `│${title}${" ".repeat(innerWidth - visibleWidth(title))}│`];
	},
	body: (lines, context) => {
		const innerWidth = Math.max(1, context.width - 2);
		return lines.flatMap((line) =>
			wrapTextWithAnsi(line, innerWidth).map(
				(fragment) => `│${fragment}${" ".repeat(innerWidth - visibleWidth(fragment))}│`,
			),
		);
	},
	closing: (context) => [`╰${"─".repeat(Math.max(1, context.width - 2))}╯`],
};

const source = `# Code-fence chrome prototype

Language-only:

\`\`\`typescript
const language = "typescript";
\`\`\`

Path-only:

\`\`\`src/format.ts
export const format = (value: string) => value.trim();
\`\`\`

Combined:

\`\`\`typescript src/components/card.ts
export const Card = () => "visible chrome";
\`\`\`

Unlabeled:

\`\`\`
plain source remains plain source
\`\`\`

- Nested list:
  \`\`\`typescript src/nested.ts
  export const nested = true;
  \`\`\`

> Blockquote:
>
> \`\`\`typescript src/quoted.ts
> export const quoted = true;
> \`\`\`

Partial closing fence:

\`\`\`typescript src/streaming.ts
export const partial = true;
\`\``;

const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);
tui.addChild(new Text("PI-29 fence chrome prototype. Resize the terminal to validate wrapping. Ctrl+C exits.", 1, 0));
tui.addChild(new Spacer(1));
tui.addChild(new Markdown(source, 1, 0, theme, undefined, { codeFenceChrome: chrome }));
tui.start();
