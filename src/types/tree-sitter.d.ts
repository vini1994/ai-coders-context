/**
 * Declarações para dependências opcionais tree-sitter.
 * Esses módulos podem não estar instalados (optionalDependencies);
 * o código usa import dinâmico e fallback quando não disponíveis.
 */
declare module 'tree-sitter' {
  const Parser: any;
  export default Parser;
}

declare module 'tree-sitter-typescript' {
  export const typescript: any;
  export const tsx: any;
}
