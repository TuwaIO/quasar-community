export const formatChainId = (chainId: string) => {
  return chainId.split(':').length > 1 ? chainId : parseInt(chainId);
};
