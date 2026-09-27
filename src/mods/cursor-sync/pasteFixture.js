import {AbstractModDeclaration, ModPackage, ObjectType} from "@spup/sdk";

// Spec fixtures: footprints for paste masks.
export const PasteSquareType = new ObjectType({name: "PasteFixtureSquare", geometry: "2x2"});
export const PasteTileType = new ObjectType({name: "PasteFixtureTile", geometry: "1x1"});

class PasteFixtureDeclaration extends AbstractModDeclaration {

    get name() {
        return "PasteFixture";
    }

    get objectTypes() {
        return [PasteSquareType, PasteTileType];
    }
}

export const PASTE_FIXTURE_PACKAGE = new ModPackage(new PasteFixtureDeclaration());
