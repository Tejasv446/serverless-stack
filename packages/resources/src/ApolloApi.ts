import { Construct } from "constructs";
import * as apig from "@aws-cdk/aws-apigatewayv2-alpha";
import {
  Api,
  ApiProps,
  ApiFunctionRouteProps,
  ApiPayloadFormatVersion,
} from "./Api";
import { Function as Fn, FunctionDefinition } from "./Function";
import { App } from "./App";
import spawn from "cross-spawn";

/////////////////////
// Interfaces
/////////////////////

export interface ApolloApiProps extends Omit<ApiProps, "routes"> {
  readonly server: FunctionDefinition;
  readonly rootPath?: string;
  /**
   * Path to graphql-codegen configuration file
   */
  codegen?: string;
}

/////////////////////
// Construct
/////////////////////

export class ApolloApi extends Api {
  private lambdaIntegration?: apig.HttpRouteIntegration;
  private rootPath?: string;
  private readonly props: ApolloApiProps;

  constructor(scope: Construct, id: string, props: ApolloApiProps) {
    const {
      server,
      rootPath = "/",
      defaultPayloadFormatVersion,
      ...restProps
    } = props || {};

    // Validate server
    if (!server) {
      throw new Error(`Missing "server" in the "${id}" ApolloApi`);
    }

    // Validate routes
    const { routes } = props as ApiProps;
    if (routes) {
      throw new Error(
        `Please use the "server" option instead of the "routes" to configure the handler for the "${id}" ApolloApi`
      );
    }

    if (props.codegen) {
      const app = App.of(scope) as App;
      if (!app.local) {
        const result = spawn.sync(
          "npx",
          ["graphql-codegen", "-c", props.codegen],
          {
            stdio: "inherit",
          }
        );
        if (result.status !== 0) {
          throw new Error(
            `Failed to generate the schema for the "${id}" ApolloApi`
          );
        }
      }
    }

    super(scope, id, {
      ...restProps,
      defaultPayloadFormatVersion:
        defaultPayloadFormatVersion || ApiPayloadFormatVersion.V1,
      routes: {
        [`GET ${rootPath}`]: server,
        [`POST ${rootPath}`]: server,
      },
    });

    this.rootPath = rootPath;
    this.props = props;
  }

  public getConstructMetadata() {
    const parent = super.getConstructMetadata();
    return {
      ...parent,
      local: {
        codegen: this.props.codegen,
      },
    };
  }

  public get serverFunction(): Fn {
    const serverFn = this.getFunction(`GET ${this.rootPath}`);

    // This should never happen
    if (!serverFn) {
      throw new Error(
        `Failed to get "serverFunction" in the "${this.node.id}" ApolloApi`
      );
    }

    return serverFn;
  }

  // Note: We want to create 1 Lambda handling both the GET and POST request.
  //       This design is based on this discussion on GitHub
  //       https://github.com/serverless-stack/serverless-stack/issues/601
  // Also Note: We cannot use the "ANY /" route because if authorization
  //            were provided, the OPTIONS route will be protected. This
  //            causes CORS to fail.
  // Solution: We will override the createFunctionIntegration() function, and
  //           it will re-use the same Route Integration for all routes.
  protected createFunctionIntegration(
    scope: Construct,
    routeKey: string,
    routeProps: ApiFunctionRouteProps,
    postfixName: string
  ): apig.HttpRouteIntegration {
    if (!this.lambdaIntegration) {
      this.lambdaIntegration = super.createFunctionIntegration(
        scope,
        routeKey,
        routeProps,
        postfixName
      );
    }

    return this.lambdaIntegration;
  }
}
