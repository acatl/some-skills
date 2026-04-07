export default {
  "*.md": (files) => {
    const filtered = files.filter((f) => !f.includes("/slides/"));
    return [
      ...(filtered.length
        ? [`markdownlint-cli2 --fix ${filtered.join(" ")}`]
        : []),
      `cspell --no-must-find-files ${files.join(" ")}`,
    ];
  },
};
