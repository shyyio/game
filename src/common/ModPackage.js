
/**
 * One mod as registered into a ModRegistry: its declaration plus the optional sim and client parts.
 */
export class ModPackage {

    /**
     * @param {AbstractModDeclaration} declaration
     * @param {object} [parts]
     * @param {AbstractSimMod|null} [parts.sim]
     * @param {AbstractClientMod|null} [parts.client]
     */
    constructor(
        declaration,
        {
            sim=null,
            client=null,
        }={},
    ) {
        this.declaration = declaration;
        this.sim = sim;
        this.client = client;
    }
}
