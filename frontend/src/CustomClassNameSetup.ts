// @ts-nocheck
import { unstable_ClassNameGenerator as ClassNameGenerator } from "@mui/material/className";
import "./runtimeIntegrityBootstrap";
import "./playerAdsBootstrap";

ClassNameGenerator.configure((componentName) => {
  let newComponentName = componentName;
  newComponentName = newComponentName.replace("Mui", "Netflix");
  newComponentName = newComponentName.replace("Button", "Btn");
  return newComponentName;
});
