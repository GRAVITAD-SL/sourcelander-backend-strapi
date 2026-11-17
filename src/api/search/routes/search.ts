export default {
  routes: [
    {
      method: "GET",
      path: "/search/freelancers",
      handler: "search.find",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
