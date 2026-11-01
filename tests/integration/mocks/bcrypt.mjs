export default { hash: async (p) => "$2b$12$" + p, compare: async (p, h) => h === "$2b$12$" + p };
