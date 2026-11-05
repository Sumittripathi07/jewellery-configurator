export default {
  test: {
    fileParallelism: false, // test files share one Postgres database
    testTimeout: 15000,
  },
};
