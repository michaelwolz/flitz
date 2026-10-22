module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "better-auth") {
        for (const name of ["vitest", "drizzle-kit"]) {
          delete pkg.peerDependencies?.[name];
          delete pkg.peerDependenciesMeta?.[name];
        }
      }
      return pkg;
    },
  },
};
