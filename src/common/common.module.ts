import { Global, Module } from "@nestjs/common";
import { CategoriesService } from "./categories.service";

@Global()
@Module({
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CommonModule {}
