import {
  ConfectMutationCtx as ConfectMutationCtxService,
  type ConfectMutationCtx as ConfectMutationCtxType,
  ConfectQueryCtx as ConfectQueryCtxService,
  type ConfectQueryCtx as ConfectQueryCtxType,
  type ConfectDataModelFromConfectSchemaDefinition,
  type ConfectDoc as ConfectDocType,
  makeFunctions,
  type TableNamesInConfectDataModel,
} from "@rjdellecese/confect/server";

import { confectSchema } from "./schema";

export const {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} = makeFunctions(confectSchema);

type ConfectSchema = typeof confectSchema;
type ConfectDataModel = ConfectDataModelFromConfectSchemaDefinition<ConfectSchema>;

export type ConfectDoc<TableName extends TableNamesInConfectDataModel<ConfectDataModel>> =
  ConfectDocType<ConfectDataModel, TableName>;

export const ConfectQueryCtx = ConfectQueryCtxService<ConfectDataModel>();
export type ConfectQueryCtx = ConfectQueryCtxType<ConfectDataModel>;

export const ConfectMutationCtx = ConfectMutationCtxService<ConfectDataModel>();
export type ConfectMutationCtx = ConfectMutationCtxType<ConfectDataModel>;
